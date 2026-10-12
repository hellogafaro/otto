#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface OttoMarkdownTextManager : RCTViewManager
@end

@implementation OttoMarkdownTextManager

RCT_EXPORT_MODULE(OttoMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface OttoMarkdownTextRunManager : RCTViewManager
@end

@implementation OttoMarkdownTextRunManager

RCT_EXPORT_MODULE(OttoMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
