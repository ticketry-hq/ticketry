#include <math.h>
#include <stdio.h>

static void muxed_ghostty_sync_font_zoom(ghostty_surface_t surface,
                                        float base_font_size, double zoom,
                                        double *applied_zoom) {
  if (surface == NULL || !isfinite(zoom) || zoom <= 0 ||
      !isfinite(base_font_size) || base_font_size <= 0 ||
      fabs(zoom - *applied_zoom) < 0.001)
    return;
  char action[64];
  int length = snprintf(action, sizeof(action), "set_font_size:%.4f",
                        base_font_size * zoom);
  if (length > 0 && (size_t)length < sizeof(action) &&
      ghostty_surface_binding_action(surface, action, (uintptr_t)length))
    *applied_zoom = zoom;
}
