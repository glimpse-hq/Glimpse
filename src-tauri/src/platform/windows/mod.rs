pub mod crash;
pub mod elevation;
pub mod icons;
pub mod live;
pub mod overlay;
pub mod store;
pub mod toast;

/// Process creation flag that keeps a console window from opening.
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
