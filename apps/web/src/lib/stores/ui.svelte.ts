// UI state shared across layout and pages
// Using a class to wrap $state so it can be mutated from imports

class UIState {
  mobileDrawerOpen = $state(false);
  settingsOverlayOpen = $state(false);
}

export const uiState = new UIState();
