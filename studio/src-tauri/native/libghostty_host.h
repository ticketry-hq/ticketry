#ifndef MUXED_LIBGHOSTTY_HOST_H
#define MUXED_LIBGHOSTTY_HOST_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  uint16_t columns;
  uint16_t rows;
} muxed_ghostty_grid_size_s;

void *muxed_ghostty_runtime_new(void);
void muxed_ghostty_runtime_free(void *runtime);

void *muxed_ghostty_view_new(void *runtime, void *parent_view,
                             const char *command);
void muxed_ghostty_view_free(void *view);
muxed_ghostty_grid_size_s
muxed_ghostty_view_set_frame(void *view, double x, double y, double width,
                             double height, double viewport_width,
                             double viewport_height);
void muxed_ghostty_view_focus(void *view);

#endif
