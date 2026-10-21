// The first letter of the domain in a sunk square, then the domain. Sites never get a color.
export function SiteMark({ name }: { name: string }) {
  const letter = (name.replace(/^https?:\/\//, '').replace(/^www\./, '')[0] ?? '?').toUpperCase();
  return (
    <span className="site">
      <b aria-hidden="true">{letter}</b>
      {name}
    </span>
  );
}
