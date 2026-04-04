export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500"
      style={{ width: size, height: size }}
    />
  );
}
