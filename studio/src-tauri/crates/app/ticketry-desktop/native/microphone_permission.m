#import <AVFoundation/AVFoundation.h>

// Prompt only on the first normal desktop launch. macOS remembers the answer;
// asking again after a denial cannot display another system prompt.
void ticketry_request_microphone_permission(void) {
  @autoreleasepool {
    if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] !=
        AVAuthorizationStatusNotDetermined) {
      return;
    }
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                            completionHandler:^(BOOL granted) {
                              (void)granted;
                            }];
  }
}
