/**
 * Utility functions for detecting device capabilities and input methods
 */

/**
 * Detects if the current device is primarily touch-based
 * This helps determine appropriate drawing behavior for fire break lines
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
  return hasTouch && (hasCoarsePointer || isSmallScreen);
};

/**
 * Detects if the device supports hover interactions
 * Touch devices typically don't have meaningful hover states
 */
export const supportsHover = (): boolean => {
  return window.matchMedia && window.matchMedia('(hover: hover)').matches;
};