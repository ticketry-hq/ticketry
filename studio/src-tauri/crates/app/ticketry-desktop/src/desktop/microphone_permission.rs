//! macOS microphone authorization for voice tools launched in the terminal.

unsafe extern "C" {
    fn ticketry_request_microphone_permission();
}

pub(crate) fn request() {
    // The native function only asks while the authorization state is unknown.
    unsafe { ticketry_request_microphone_permission() }
}
