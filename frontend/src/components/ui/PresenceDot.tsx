interface Props {
  status: "online" | "offline" | string;
  size?: number;
  borderColor?: string;
}

export function PresenceDot({ status, size = 10, borderColor = "var(--color-dc-bg-secondary)" }: Props) {
  const color =
    status === "online" ? "var(--color-dc-online)"
    : status === "idle" ? "var(--color-dc-idle)"
    : status === "dnd" ? "var(--color-dc-dnd)"
    : "var(--color-dc-offline, var(--color-dc-text-muted))";
  return (
    <div
      className="absolute rounded-full border-2 flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderColor,
        bottom: -1,
        right: -1,
      }}
    />
  );
}
