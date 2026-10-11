// Real pinned-libghostty PTY capture used by production-host input acceptance.
// The child runs inside Ghostty's actual PTY and records unmodified bytes.
static int capture_input(const char *directory) {
  struct termios settings;
  if (tcgetattr(STDIN_FILENO, &settings) != 0) return 2;
  cfmakeraw(&settings);
  if (tcsetattr(STDIN_FILENO, TCSANOW, &settings) != 0) return 2;
  char path[4096];
  snprintf(path, sizeof(path), "%s/bytes", directory);
  int output = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (output < 0) return 2;
  snprintf(path, sizeof(path), "%s/ready", directory);
  int ready = open(path, O_WRONLY | O_CREAT, 0600);
  if (ready < 0) return 2;
  close(ready);
  unsigned char byte;
  while (read(STDIN_FILENO, &byte, 1) == 1)
    if (write(output, &byte, 1) != 1) return 2;
  close(output);
  return 0;
}

static void tick(ghostty_app_t app) {
  ghostty_app_tick(app);
  [[NSRunLoop currentRunLoop]
      runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}

static void wait_for_ready(ghostty_app_t app, const char *directory) {
  char path[4096];
  snprintf(path, sizeof(path), "%s/ready", directory);
  for (int attempt = 0; attempt < 500; attempt++) {
    if (access(path, F_OK) == 0) return;
    tick(app);
  }
  require(false, "the raw PTY capture child did not start");
}

static void expect_bytes(ghostty_app_t app, const char *directory,
                         const char *expected, size_t length) {
  char path[4096];
  snprintf(path, sizeof(path), "%s/bytes", directory);
  unsigned char actual[64];
  size_t count = 0;
  for (int attempt = 0; attempt < 500; attempt++) {
    FILE *input = fopen(path, "rb");
    if (input != NULL) {
      count = fread(actual, 1, sizeof(actual), input);
      fclose(input);
    }
    if (count >= length) break;
    tick(app);
  }
  if (count != length || memcmp(actual, expected, length) != 0) {
    fprintf(stderr, "PTY bytes:");
    for (size_t index = 0; index < count; index++)
      fprintf(stderr, " %02x", actual[index]);
    fprintf(stderr, " (expected %zu bytes)\n", length);
    exit(1);
  }
}

