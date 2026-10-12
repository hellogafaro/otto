#pragma once

#include "OttoMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using OttoMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<OttoMarkdownTextRunShadowNode>;

void OttoMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
