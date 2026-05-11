use std::error::Error;
use std::fmt;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BusConfig {
    capacity: usize,
}

impl BusConfig {
    pub const DEFAULT_CAPACITY: usize = 256;

    pub fn new(capacity: usize) -> Result<Self, BusConfigError> {
        if capacity == 0 {
            return Err(BusConfigError::ZeroCapacity);
        }
        Ok(Self { capacity })
    }

    pub fn capacity(self) -> usize {
        self.capacity
    }
}

impl Default for BusConfig {
    fn default() -> Self {
        Self {
            capacity: Self::DEFAULT_CAPACITY,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusConfigError {
    ZeroCapacity,
}

impl fmt::Display for BusConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroCapacity => write!(f, "service bus capacity must be greater than zero"),
        }
    }
}

impl Error for BusConfigError {}

pub fn bounded<T>(config: BusConfig) -> (BusSender<T>, BusReceiver<T>) {
    let (sender, receiver) = mpsc::sync_channel(config.capacity);
    (
        BusSender {
            sender,
            capacity: config.capacity,
        },
        BusReceiver { receiver },
    )
}

#[derive(Debug)]
pub struct BusSender<T> {
    sender: SyncSender<T>,
    capacity: usize,
}

impl<T> Clone for BusSender<T> {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            capacity: self.capacity,
        }
    }
}

impl<T> BusSender<T> {
    pub fn try_publish(&self, item: T) -> Result<(), BusSendError<T>> {
        match self.sender.try_send(item) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(item)) => Err(BusSendError::Backpressure {
                item: Box::new(item),
                capacity: self.capacity,
            }),
            Err(TrySendError::Disconnected(item)) => Err(BusSendError::Closed {
                item: Box::new(item),
            }),
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

#[derive(Debug)]
pub struct BusReceiver<T> {
    receiver: Receiver<T>,
}

impl<T> BusReceiver<T> {
    pub fn recv_timeout(&self, timeout: Duration) -> Result<T, BusRecvError> {
        match self.receiver.recv_timeout(timeout) {
            Ok(item) => Ok(item),
            Err(RecvTimeoutError::Timeout) => Err(BusRecvError::Timeout),
            Err(RecvTimeoutError::Disconnected) => Err(BusRecvError::Closed),
        }
    }

    pub fn try_recv(&self) -> Result<T, BusTryRecvError> {
        match self.receiver.try_recv() {
            Ok(item) => Ok(item),
            Err(TryRecvError::Empty) => Err(BusTryRecvError::Empty),
            Err(TryRecvError::Disconnected) => Err(BusTryRecvError::Closed),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum BusSendError<T> {
    Backpressure { item: Box<T>, capacity: usize },
    Closed { item: Box<T> },
}

impl<T> BusSendError<T> {
    pub fn is_backpressure(&self) -> bool {
        matches!(self, Self::Backpressure { .. })
    }

    pub fn into_item(self) -> T {
        match self {
            Self::Backpressure { item, .. } | Self::Closed { item } => *item,
        }
    }
}

impl<T> fmt::Display for BusSendError<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backpressure { capacity, .. } => {
                write!(f, "service bus capacity {capacity} reached")
            }
            Self::Closed { .. } => write!(f, "service bus receiver is closed"),
        }
    }
}

impl<T: fmt::Debug> Error for BusSendError<T> {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusRecvError {
    Timeout,
    Closed,
}

impl fmt::Display for BusRecvError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => write!(f, "timed out waiting for service bus item"),
            Self::Closed => write!(f, "service bus sender is closed"),
        }
    }
}

impl Error for BusRecvError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusTryRecvError {
    Empty,
    Closed,
}

impl fmt::Display for BusTryRecvError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "service bus is empty"),
            Self::Closed => write!(f, "service bus sender is closed"),
        }
    }
}

impl Error for BusTryRecvError {}
