export function Coco({
  state = "idle",
  small = false,
}: {
  state?: string;
  small?: boolean;
}) {
  return (
    <span className={`coco-dog ${small ? "small" : ""} ${state}`}>
      <img
        src="/favicon.svg"
        alt="Coco, your little dog companion"
      />
      <span className="dog-shadow" />
    </span>
  );
}
