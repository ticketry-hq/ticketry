// Per-view ownership for a Ghostty surface.

#import <stdint.h>
#import <string.h>

static const uint64_t kMuxedGhosttySurfaceOwnerMagic =
    0x5449434B45545259ULL;

typedef struct {
  uint64_t magic;
  ghostty_surface_t surface;
  void *viewer;
  bool available;
} muxed_ghostty_surface_owner_s;

static const muxed_ghostty_surface_owner_s *
muxed_ghostty_surface_owner_from_userdata(const void *userdata) {
  if (userdata == NULL) return NULL;

  uint64_t magic = 0;
  memcpy(&magic, userdata, sizeof(magic));
  if (magic != kMuxedGhosttySurfaceOwnerMagic) return NULL;
  return userdata;
}

static void muxed_ghostty_surface_owner_init(
    muxed_ghostty_surface_owner_s *owner, void *viewer) {
  if (owner == NULL) return;
  owner->magic = kMuxedGhosttySurfaceOwnerMagic;
  owner->surface = NULL;
  owner->viewer = viewer;
  owner->available = false;
}

static void muxed_ghostty_surface_owner_activate(
    muxed_ghostty_surface_owner_s *owner, ghostty_surface_t surface) {
  if (owner == NULL || surface == NULL) return;
  owner->surface = surface;
  owner->available = true;
}

static void muxed_ghostty_surface_owner_invalidate(
    muxed_ghostty_surface_owner_s *owner) {
  if (owner == NULL) return;
  owner->available = false;
  owner->surface = NULL;
  owner->viewer = NULL;
}

static ghostty_surface_t muxed_ghostty_owned_surface(
    const muxed_ghostty_surface_owner_s *owner) {
  owner = muxed_ghostty_surface_owner_from_userdata(owner);
  if (owner == NULL || !owner->available) return NULL;
  return owner->surface;
}

static void *muxed_ghostty_owned_viewer(
    const muxed_ghostty_surface_owner_s *owner) {
  owner = muxed_ghostty_surface_owner_from_userdata(owner);
  if (owner == NULL || !owner->available) return NULL;
  return owner->viewer;
}
