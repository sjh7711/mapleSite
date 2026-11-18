// Restore shared storage before evaluating ANY calculator dependency. Optional
// features download together, but their failure must not stop the calculator.
export async function startCalculator({ initialize, loadCalculator, features = [], onReady, onError }) {
  const status = await initialize();
  const pending = features.map(({ load }) => Promise.resolve().then(load).then(
    (module) => ({ module }), (error) => ({ error }),
  ));
  const calculator = await loadCalculator();
  onReady?.(calculator, status);
  await Promise.all(features.map(async (feature, index) => {
    try {
      const result = await pending[index];
      if (result.error) throw result.error;
      await feature.install(result.module, calculator, status);
    } catch (error) {
      onError?.(error, feature.name);
    }
  }));
  return status;
}
