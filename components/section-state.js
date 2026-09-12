export function LoadingCard({ text = "Loading…" }) { return <div className="card muted">{text}</div>; }
export function ErrorCard({ message }) { return message ? <div className="error">{message}</div> : null; }
export function EmptyCard({ text }) { return <div className="card muted">{text}</div>; }
