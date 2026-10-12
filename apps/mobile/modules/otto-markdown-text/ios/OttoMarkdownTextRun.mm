#import "OttoMarkdownTextRun.h"
#import "OttoMarkdownText.h"
#import "OttoMarkdownTextRunComponentDescriptor.h"
#import <react/renderer/components/T3MarkdownTextSpec/EventEmitters.h>
#import <react/renderer/components/T3MarkdownTextSpec/Props.h>
#import <react/renderer/components/T3MarkdownTextSpec/RCTComponentViewHelpers.h>
#import "RCTFabricComponentsPlugins.h"
#import "Utils.h"

using namespace facebook::react;

@interface OttoMarkdownTextRun () <RCTOttoMarkdownTextRunViewProtocol>

@end

@implementation OttoMarkdownTextRun {
  NSString * _text;
  RCTBubblingEventBlock _onPress;
  RCTBubblingEventBlock _onLongPress;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<OttoMarkdownTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const OttoMarkdownTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<OttoMarkdownTextRunProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<OttoMarkdownTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)onPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::OttoMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onPress(facebook::react::OttoMarkdownTextRunEventEmitter::OnPress{});
  }
}

- (void)onLongPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::OttoMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onLongPress(facebook::react::OttoMarkdownTextRunEventEmitter::OnLongPress{});
  }
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> OttoMarkdownTextRunCls(void)
{
    return OttoMarkdownTextRun.class;
}

@end
