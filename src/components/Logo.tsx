export function Logo({ icon = true }: { icon?: boolean }) {
  return (
    <span className="logo">
      {icon && <img src="/icons/icon-192.png" alt="" />}
      <span>
        <span className="logo-a">Cardtell</span>
        <span className="logo-b">icence</span>
      </span>
    </span>
  );
}
