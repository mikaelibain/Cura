export type CanvasActivation = 'click' | 'double-activate' | 'enter';
export type CanvasActivationIntent = 'select' | 'edit';

/** Keep selection and editing as separate, explicit canvas actions. */
export const canvasActivationIntent = (
  activation: CanvasActivation,
  selected: boolean,
): CanvasActivationIntent => activation === 'click' || !selected ? 'select' : 'edit';
