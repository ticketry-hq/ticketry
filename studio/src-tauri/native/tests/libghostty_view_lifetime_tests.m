static void test_native_view_lifetime(void) {
  // Runtime teardown frees the view and then the Ghostty app. The surface
  // must be gone before the app even when AppKit still retains the view.
  MuxedGhosttyView *freed_view = [MuxedGhosttyView new];
  int freed_surface_storage = 0;
  freed_view->_surface = (ghostty_surface_t)&freed_surface_storage;
  muxed_ghostty_surface_owner_init(&freed_view->_surfaceOwner, freed_view);
  muxed_ghostty_surface_owner_activate(&freed_view->_surfaceOwner,
                                       freed_view->_surface);
  [freed_view retain];
  void *freed_handle = muxed_ghostty_register_view(freed_view);
  muxed_ghostty_view_free(freed_handle);
  require(surface_free_count == 1 &&
              last_freed_surface == (ghostty_surface_t)&freed_surface_storage,
          "freeing a retained view did not free its surface immediately");
  require(freed_view->_surface == NULL &&
              muxed_ghostty_owned_surface(&freed_view->_surfaceOwner) == NULL,
          "a freed view still exposed its surface");
  [freed_view release];
  require(surface_free_count == 1,
          "deallocating a freed view freed its surface a second time");

  // Simulate a queued frame/focus/hide arriving after detach destroyed its
  // view. No command may dereference that view or revive its callbacks.
  muxed_ghostty_view_free(freed_handle);
  muxed_ghostty_view_hide(freed_handle);
  muxed_ghostty_view_focus(freed_handle);
  muxed_ghostty_view_set_scroll_callback(freed_handle, record_tmux_scroll, NULL);
  muxed_ghostty_view_set_chord_callback(freed_handle, NULL, NULL);
  muxed_ghostty_view_set_resize_callback(freed_handle, NULL, NULL);
  require(muxed_ghostty_view_set_frame(freed_handle, 0, 0, 100, 100, 100, 100).columns == 0,
          "a stale frame command reached a detached view");
  require(!muxed_ghostty_view_present(freed_handle) &&
              !muxed_ghostty_view_set_webview_interaction(freed_handle, false) &&
              !muxed_ghostty_view_wait_for_redraw(freed_handle, 0, 0),
          "a detached handle still accepted commands");
  void *replacement = muxed_ghostty_register_view([MuxedGhosttyView new]);
  require(replacement != freed_handle &&
              muxed_ghostty_view_for_handle(freed_handle) == nil,
          "an old handle resolved to a replacement view");
  muxed_ghostty_view_free(replacement);
  require(muxed_ghostty_live_views().count == 0,
          "detached views leaked in the handle registry");
}
