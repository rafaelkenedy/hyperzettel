use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Weak,
    },
};

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Notify};

use crate::knowledge::{
    application::RelationApplicationService,
    domain::{IndexingCheckpoint, RelationStatus, RELATION_CONFIG},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexReason {
    Created,
    Updated,
    Imported,
    Restored,
    InitialIndex,
    ManualRebuild,
}

impl IndexReason {
    fn is_high_priority(self) -> bool {
        matches!(
            self,
            Self::Created | Self::Updated | Self::Imported | Self::Restored
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexRequest {
    pub note_id: String,
    pub revision: String,
    pub reason: IndexReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueSnapshot {
    pub pending: usize,
    pub processed: usize,
    pub total: usize,
    pub paused: bool,
}

#[derive(Default)]
struct QueueState {
    pending: HashMap<String, IndexRequest>,
    order: VecDeque<String>,
    current: Option<IndexRequest>,
    processed: usize,
    total: usize,
    paused: bool,
}

pub struct EmbeddingQueue {
    state: Mutex<QueueState>,
    notify: Notify,
    started: AtomicBool,
    shutdown: AtomicBool,
}

impl Default for EmbeddingQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl EmbeddingQueue {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(QueueState::default()),
            notify: Notify::new(),
            started: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
        }
    }

    pub fn start(self: &Arc<Self>, service: Weak<RelationApplicationService>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let queue = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            queue.consume(service).await;
        });
    }

    pub async fn enqueue(&self, request: IndexRequest) -> bool {
        let mut state = self.state.lock().await;
        let is_new = !state.pending.contains_key(&request.note_id);
        if is_new {
            state.total = state.total.saturating_add(1);
            if request.reason.is_high_priority() {
                state.order.push_front(request.note_id.clone());
            } else {
                state.order.push_back(request.note_id.clone());
            }
        } else if request.reason.is_high_priority() {
            state.order.retain(|note_id| note_id != &request.note_id);
            state.order.push_front(request.note_id.clone());
        }
        state.pending.insert(request.note_id.clone(), request);
        drop(state);
        self.notify.notify_one();
        is_new
    }

    pub async fn enqueue_batch(&self, requests: Vec<IndexRequest>) -> usize {
        let mut state = self.state.lock().await;
        state.pending.clear();
        state.order.clear();
        state.processed = 0;
        for request in requests {
            if !state.pending.contains_key(&request.note_id) {
                state.order.push_back(request.note_id.clone());
            }
            state.pending.insert(request.note_id.clone(), request);
        }
        state.total = state.pending.len();
        let total = state.total;
        drop(state);
        self.notify.notify_one();
        total
    }

    pub async fn pause(&self) {
        self.state.lock().await.paused = true;
    }

    pub async fn resume(&self) {
        self.state.lock().await.paused = false;
        self.notify.notify_one();
    }

    pub async fn cancel_note(&self, note_id: &str) {
        let mut state = self.state.lock().await;
        state.pending.remove(note_id);
        state.order.retain(|candidate| candidate != note_id);
    }

    pub async fn snapshot(&self) -> QueueSnapshot {
        let state = self.state.lock().await;
        QueueSnapshot {
            pending: state.pending.len(),
            processed: state.processed,
            total: state.total,
            paused: state.paused,
        }
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn consume(self: Arc<Self>, service: Weak<RelationApplicationService>) {
        loop {
            if self.shutdown.load(Ordering::Acquire) {
                return;
            }
            let Some(request) = self.take_next().await else {
                self.notify.notified().await;
                continue;
            };
            let Some(service) = service.upgrade() else {
                return;
            };
            let snapshot = self.snapshot().await;
            let _ = service.set_status(RelationStatus::Indexing {
                processed: snapshot.processed,
                total: snapshot.total,
                current_note_id: Some(request.note_id.clone()),
            });

            let result = service.index(&request.note_id, &request.revision).await;
            let snapshot = self.finish_current().await;
            let checkpoint_status = match &result {
                Err(_) => "failed",
                Ok(_) if snapshot.paused => "paused",
                Ok(_) if snapshot.pending == 0 => "completed",
                Ok(_) => "indexing",
            };
            let _ = service
                .relation_repository
                .put_checkpoint(&IndexingCheckpoint {
                    pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
                    processed_count: snapshot.processed,
                    total_count: snapshot.total,
                    status: checkpoint_status.to_owned(),
                    last_processed_note_id: Some(request.note_id.clone()),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });
            match result {
                Ok(_) if snapshot.pending == 0 => {
                    let relation_count = service
                        .relation_repository
                        .get_for_note(&request.note_id)
                        .map_or(0, |relations| relations.len());
                    let _ = service.set_status(RelationStatus::Ready { relation_count });
                }
                Ok(_) => {
                    let _ = service.set_status(RelationStatus::Indexing {
                        processed: snapshot.processed,
                        total: snapshot.total,
                        current_note_id: None,
                    });
                }
                Err(error) => {
                    let _ = service.set_status(RelationStatus::Error {
                        code: error.code().to_owned(),
                        message: error.safe_message().to_owned(),
                        retryable: error.retryable(),
                    });
                }
            }
        }
    }

    async fn take_next(&self) -> Option<IndexRequest> {
        let mut state = self.state.lock().await;
        if state.paused || state.current.is_some() {
            return None;
        }
        while let Some(note_id) = state.order.pop_front() {
            if let Some(request) = state.pending.remove(&note_id) {
                state.current = Some(request.clone());
                return Some(request);
            }
        }
        None
    }

    async fn finish_current(&self) -> QueueSnapshot {
        let mut state = self.state.lock().await;
        state.current = None;
        state.processed = state.processed.saturating_add(1).min(state.total);
        QueueSnapshot {
            pending: state.pending.len(),
            processed: state.processed,
            total: state.total,
            paused: state.paused,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(note_id: &str, revision: &str, reason: IndexReason) -> IndexRequest {
        IndexRequest {
            note_id: note_id.to_owned(),
            revision: revision.to_owned(),
            reason,
        }
    }

    #[tokio::test]
    async fn repeated_note_keeps_only_the_latest_revision() {
        let queue = EmbeddingQueue::new();
        queue
            .enqueue(request("a", "r1", IndexReason::Updated))
            .await;
        queue
            .enqueue(request("a", "r2", IndexReason::Updated))
            .await;
        let next = queue.take_next().await.expect("request");
        assert_eq!(next.revision, "r2");
        assert_eq!(queue.snapshot().await.total, 1);
    }

    #[tokio::test]
    async fn edited_note_has_priority_over_initial_indexing() {
        let queue = EmbeddingQueue::new();
        queue
            .enqueue(request("a", "r1", IndexReason::InitialIndex))
            .await;
        queue
            .enqueue(request("b", "r1", IndexReason::Updated))
            .await;
        assert_eq!(queue.take_next().await.expect("request").note_id, "b");
    }

    #[tokio::test]
    async fn pause_resume_and_cancel_control_pending_work() {
        let queue = EmbeddingQueue::new();
        queue
            .enqueue(request("a", "r1", IndexReason::InitialIndex))
            .await;
        queue.pause().await;
        assert!(queue.take_next().await.is_none());
        queue.resume().await;
        assert!(queue.take_next().await.is_some());
        queue.finish_current().await;
        queue
            .enqueue(request("b", "r1", IndexReason::InitialIndex))
            .await;
        queue.cancel_note("b").await;
        assert_eq!(queue.snapshot().await.pending, 0);
    }
}
