#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <QuartzCore/QuartzCore.h>

static NSPanel *guidePanel;
static NSTimer *guideTimer;
static BOOL sawSettingsWindow;
static NSTimeInterval guideOpenedAt;
static CGWindowID settingsWindow;
static BOOL settingsReachable;
static id guideMonitor;
static NSString *const settingsBundleID = @"com.apple.systempreferences";
static NSUInteger settingsRequest;

@interface GlimpseDragView : NSView <NSDraggingSource>
@property(nonatomic, strong) NSURL *bundleURL;
@property(nonatomic, strong) NSImage *appIcon;
@property(nonatomic, copy) NSString *appName;
@property(nonatomic, strong) NSEvent *mouseDownEvent;
@end

@implementation GlimpseDragView

- (instancetype)initWithFrame:(NSRect)frame bundleURL:(NSURL *)bundleURL {
    self = [super initWithFrame:frame];
    if (self) {
        _bundleURL = bundleURL;
        _appIcon = [[NSWorkspace sharedWorkspace] iconForFile:bundleURL.path];
        _appIcon.size = NSMakeSize(32, 32);
        _appName = [[NSFileManager defaultManager] displayNameAtPath:bundleURL.path].stringByDeletingPathExtension;
        self.wantsLayer = YES;
        self.layer.shadowOpacity = 0.18;
        self.layer.shadowRadius = 6;
        self.layer.shadowOffset = CGSizeMake(0, -2);
        CGPathRef shadow = CGPathCreateWithRoundedRect(self.bounds, 10, 10, NULL);
        self.layer.shadowPath = shadow;
        CGPathRelease(shadow);
        if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
            [self nudge];
        }
    }
    return self;
}

/// Lifts the tile toward the list now and then, until it is picked up.
- (void)nudge {
    CAKeyframeAnimation *lift = [CAKeyframeAnimation animationWithKeyPath:@"transform.translation.y"];
    CAMediaTimingFunction *ease =
        [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    lift.values = @[ @0, @5, @0, @0 ];
    lift.keyTimes = @[ @0, @0.14, @0.32, @1 ];
    lift.timingFunctions = @[ ease, ease, ease ];
    lift.duration = 2.6;
    lift.beginTime = CACurrentMediaTime() + 0.6;
    lift.repeatCount = HUGE_VALF;
    [self.layer addAnimation:lift forKey:@"nudge"];
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (void)resetCursorRects {
    [self addCursorRect:self.bounds cursor:NSCursor.openHandCursor];
}

- (void)drawRect:(NSRect)dirtyRect {
    BOOL dark = [self.effectiveAppearance bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]] == NSAppearanceNameDarkAqua;
    [(dark ? [NSColor colorWithWhite:1 alpha:0.14] : NSColor.whiteColor) setFill];
    [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:10 yRadius:10] fill];
    [self.appIcon drawInRect:NSMakeRect(10, 6, 32, 32)];
    [self.appName drawAtPoint:NSMakePoint(52, 13) withAttributes:@{
        NSFontAttributeName: [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold],
        NSForegroundColorAttributeName: NSColor.labelColor,
    }];
    NSImageSymbolConfiguration *style = [[NSImageSymbolConfiguration
        configurationWithPointSize:15 weight:NSFontWeightSemibold]
        configurationByApplyingConfiguration:[NSImageSymbolConfiguration
            configurationWithHierarchicalColor:NSColor.controlAccentColor]];
    NSImage *arrow = [[NSImage imageWithSystemSymbolName:@"arrow.up" accessibilityDescription:nil]
        imageWithSymbolConfiguration:style];
    [arrow drawAtPoint:NSMakePoint(NSMaxX(self.bounds) - 14 - arrow.size.width,
                                   NSMidY(self.bounds) - arrow.size.height / 2)
              fromRect:NSZeroRect
             operation:NSCompositingOperationSourceOver
              fraction:1];
}

- (void)mouseDown:(NSEvent *)event {
    [self.layer removeAnimationForKey:@"nudge"];
    self.mouseDownEvent = event;
}

- (void)mouseDragged:(NSEvent *)event {
    if (self.mouseDownEvent == nil) {
        return;
    }
    CGFloat dx = event.locationInWindow.x - self.mouseDownEvent.locationInWindow.x;
    CGFloat dy = event.locationInWindow.y - self.mouseDownEvent.locationInWindow.y;
    if (hypot(dx, dy) < 3) {
        return;
    }

    NSDraggingItem *item = [[NSDraggingItem alloc] initWithPasteboardWriter:self.bundleURL];
    NSBitmapImageRep *representation = [self bitmapImageRepForCachingDisplayInRect:self.bounds];
    [self cacheDisplayInRect:self.bounds toBitmapImageRep:representation];
    NSImage *snapshot = [[NSImage alloc] initWithSize:self.bounds.size];
    [snapshot addRepresentation:representation];
    [item setDraggingFrame:self.bounds contents:snapshot];

    NSDraggingSession *session = [self beginDraggingSessionWithItems:@[ item ]
                                                               event:self.mouseDownEvent
                                                              source:self];
    session.animatesToStartingPositionsOnCancelOrFail = YES;
    self.mouseDownEvent = nil;
}

- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
    return NSDragOperationCopy;
}

@end

static NSArray *onScreenWindows(void) {
    return CFBridgingRelease(CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
}

static pid_t settingsPid(void) {
    NSArray<NSRunningApplication *> *apps =
        [NSRunningApplication runningApplicationsWithBundleIdentifier:settingsBundleID];
    return apps.count > 0 ? apps.firstObject.processIdentifier : 0;
}

/// The largest System Settings window, in Quartz coordinates.
static CGRect settingsFrame(void) {
    pid_t pid = settingsPid();
    CGRect best = CGRectNull;
    settingsWindow = 0;
    if (pid == 0) {
        return best;
    }
    for (NSDictionary *window in onScreenWindows()) {
        if ([window[(id)kCGWindowOwnerPID] intValue] != pid ||
            [window[(id)kCGWindowLayer] integerValue] != 0) {
            continue;
        }
        CGRect frame;
        if (!CGRectMakeWithDictionaryRepresentation(
                (__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame) ||
            frame.size.width < 300 || frame.size.height < 200) {
            continue;
        }
        if (CGRectIsNull(best) ||
            frame.size.width * frame.size.height > best.size.width * best.size.height) {
            best = frame;
            settingsWindow = [window[(id)kCGWindowNumber] unsignedIntValue];
        }
    }
    return best;
}

/// One window's frame while it is on screen, cheap enough to read every frame.
static CGRect windowFrame(CGWindowID windowID) {
    const void *value = (const void *)(uintptr_t)windowID;
    CFArrayRef ids = CFArrayCreate(NULL, &value, 1, NULL);
    NSArray *info = CFBridgingRelease(CGWindowListCreateDescriptionFromArray(ids));
    CFRelease(ids);
    NSDictionary *window = info.firstObject;
    CGRect frame;
    if (![window[(id)kCGWindowIsOnscreen] boolValue] ||
        !CGRectMakeWithDictionaryRepresentation(
            (__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame)) {
        return CGRectNull;
    }
    return frame;
}

/// A System Settings that isn't running yet restores its last pane instead of
/// the one in the URL, so after a cold launch the URL goes again once it's up.
static void openSettingsPane(NSURL *url) {
    BOOL cold = settingsPid() == 0;
    NSUInteger request = ++settingsRequest;
    [[NSWorkspace sharedWorkspace] openURL:url];
    if (!cold) {
        return;
    }
    __block NSUInteger polls = 0;
    [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        polls += 1;
        if (request != settingsRequest || polls > 100) {
            [timer invalidate];
            return;
        }
        if (CGRectIsNull(settingsFrame())) {
            return;
        }
        [timer invalidate];
        for (NSNumber *delay in @[ @0.35, @1.2 ]) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay.doubleValue * NSEC_PER_SEC)),
                           dispatch_get_main_queue(), ^{
                if (request == settingsRequest) {
                    [[NSWorkspace sharedWorkspace] openURL:url];
                }
            });
        }
    }];
}

static void closeGuide(void) {
    [guideTimer invalidate];
    guideTimer = nil;
    [guidePanel orderOut:nil];
    guidePanel = nil;
    if (guideMonitor != nil) {
        [NSEvent removeMonitor:guideMonitor];
        guideMonitor = nil;
    }
    sawSettingsWindow = NO;
    settingsWindow = 0;
}

/// Pins the guide to the bottom right of System Settings while Settings or
/// Glimpse is in front.
static void placeGuide(void) {
    CGRect quartz = settingsWindow != 0 ? windowFrame(settingsWindow) : CGRectNull;
    if (CGRectIsNull(quartz) || !settingsReachable) {
        settingsWindow = CGRectIsNull(quartz) ? 0 : settingsWindow;
        [guidePanel orderOut:nil];
        return;
    }
    if (!sawSettingsWindow) {
        sawSettingsWindow = YES;
        guidePanel.alphaValue = 0;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
                context.duration = 0.2;
                guidePanel.animator.alphaValue = 1;
            }];
        });
    }
    CGFloat primaryHeight = NSScreen.screens.firstObject.frame.size.height;
    NSRect settings = NSMakeRect(quartz.origin.x, primaryHeight - CGRectGetMaxY(quartz),
                                 quartz.size.width, quartz.size.height);
    NSPoint anchor = NSMakePoint(NSMaxX(settings) - 16, NSMinY(settings) + 16);
    NSScreen *screen = NSScreen.mainScreen;
    for (NSScreen *candidate in NSScreen.screens) {
        if (NSPointInRect(anchor, candidate.frame)) {
            screen = candidate;
            break;
        }
    }
    NSRect visible = screen.visibleFrame;
    NSSize size = guidePanel.frame.size;
    CGFloat x = MIN(MAX(anchor.x - size.width, NSMinX(visible) + 8), NSMaxX(visible) - size.width - 8);
    CGFloat y = MIN(MAX(anchor.y, NSMinY(visible) + 8), NSMaxY(visible) - size.height - 8);
    [guidePanel setFrameOrigin:NSMakePoint(x, y)];
    if (!guidePanel.visible) {
        [guidePanel orderFrontRegardless];
    }
}

/// Closes the guide once access is granted or Settings quits.
static void checkGuide(void) {
    if (AXIsProcessTrusted() || (sawSettingsWindow && settingsPid() == 0) ||
        (!sawSettingsWindow && NSDate.date.timeIntervalSince1970 - guideOpenedAt > 10)) {
        closeGuide();
        return;
    }
    NSString *front = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier;
    settingsReachable = [front isEqualToString:settingsBundleID] || NSApp.isActive;
    if (settingsWindow == 0) {
        settingsFrame();
    }
    placeGuide();
}

/// Opens Accessibility in System Settings with a floating tile beside it that
/// drags Glimpse into the list. Main thread only.
void glimpse_show_accessibility_guide(const char *instruction) {
    closeGuide();
    guideOpenedAt = NSDate.date.timeIntervalSince1970;
    openSettingsPane([NSURL URLWithString:
        @"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"]);
    NSURL *bundleURL = NSBundle.mainBundle.bundleURL.standardizedURL;
    // A development binary has no bundle to drag.
    if (![bundleURL.pathExtension.lowercaseString isEqualToString:@"app"]) {
        return;
    }

    NSSize size = NSMakeSize(360, 108);
    guidePanel = [[NSPanel alloc]
        initWithContentRect:NSMakeRect(0, 0, size.width, size.height)
                  styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                    backing:NSBackingStoreBuffered
                      defer:NO];
    guidePanel.floatingPanel = YES;
    guidePanel.level = NSFloatingWindowLevel;
    guidePanel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                    NSWindowCollectionBehaviorFullScreenAuxiliary;
    guidePanel.opaque = NO;
    guidePanel.backgroundColor = NSColor.clearColor;
    guidePanel.hasShadow = YES;
    guidePanel.hidesOnDeactivate = NO;
    guidePanel.releasedWhenClosed = NO;

    NSVisualEffectView *content = [[NSVisualEffectView alloc]
        initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
    content.material = NSVisualEffectMaterialPopover;
    content.state = NSVisualEffectStateActive;
    CGFloat radius = 16;
    NSImage *mask = [NSImage imageWithSize:NSMakeSize(2 * radius + 1, 2 * radius + 1)
                                   flipped:NO
                            drawingHandler:^BOOL(NSRect rect) {
        [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
        return YES;
    }];
    mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
    content.maskImage = mask;

    NSTextField *label = [NSTextField labelWithString:[NSString stringWithUTF8String:instruction]];
    label.frame = NSMakeRect(16, 70, size.width - 32, 20);
    label.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
    label.lineBreakMode = NSLineBreakByTruncatingTail;
    [content addSubview:label];
    [content addSubview:[[GlimpseDragView alloc]
                            initWithFrame:NSMakeRect(16, 16, size.width - 32, 44)
                                bundleURL:bundleURL]];
    guidePanel.contentView = content;

    guideTimer = [NSTimer scheduledTimerWithTimeInterval:0.12 repeats:YES block:^(__unused NSTimer *timer) {
        checkGuide();
    }];
    // Dragging Settings around moves it between checks; mouse monitors need no
    // Accessibility access.
    guideMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDragged |
                                                                  NSEventMaskLeftMouseUp
                                                          handler:^(__unused NSEvent *event) {
        placeGuide();
    }];
    checkGuide();
}
