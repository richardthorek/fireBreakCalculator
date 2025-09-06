/**
 * Utility functions for detecting device capabilities and input methods
 * Used to optimize touch controls for Mapbox GL JS fire break drawing
 */

/**
 * Detects if the current device is primarily touch-based
 * This helps determine appropriate drawing behavior for fire break lines
 * 
 * Optimized for Mapbox GL JS touch interaction:
 * - Touch devices get larger touch buffers and visual feedback
 * - Mouse devices get precise click handling
 * - Automatically shows touch hints on appropriate devices
 */
export const isTouchDevice = (): boolean => {
  // Check for touch support in multiple ways for better accuracy
  const hasTouch = 'ontouchstart' in window || 
                   navigator.maxTouchPoints > 0 || 
                   (navigator as any).msMaxTouchPoints > 0;
  
  // Check if device has a pointer that is coarse (touch) vs fine (mouse)
  const hasCoarsePointer = window.matchMedia && 
                          window.matchMedia('(pointer: coarse)').matches;
  
  // Combine touch support with screen size for better detection
  const isSmallScreen = window.innerWidth <= 768;
  
  // Device is considered touch-primary if it has touch AND (coarse pointer OR small screen)
  // This helps differentiate between touch-first devices and desktop with touch support
  return hasTouch && (hasCoarsePointer || isSmallScreen);
};

/**
 * Detects if the device supports hover interactions
 * Touch devices typically don't have meaningful hover states
 */
export const supportsHover = (): boolean => {
  return window.matchMedia && window.matchMedia('(hover: hover)').matches;
};