/** Full-screen confetti for a sent operation. Loaded lazily, skipped for reduced motion. */
export const celebrate = async (): Promise<void> => {
  try {
    const { default: confetti } = await import('canvas-confetti');
    const fire = (ratio: number, opts: Record<string, number>): void => {
      void confetti({
        origin: { y: 0.7 },
        disableForReducedMotion: true,
        zIndex: 1000,
        particleCount: Math.floor(220 * ratio),
        ...opts,
      });
    };
    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  } catch {
    // Decorative only.
  }
};
