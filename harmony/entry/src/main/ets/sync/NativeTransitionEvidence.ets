// Native-only: this evidence does not expose credentials to the web document.
export interface NativeTransitionEvidence {
  syncTransitionVersion(): number;
  syncTransitionConfirmedAfter(start: number): boolean;
}
