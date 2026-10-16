import { useNavigate } from 'react-router-dom';

/** Row of ready-made questions to the assistant about what is on screen. */
export function AskAi({ ctx, prompts }: { ctx: string; prompts: string[] }) {
  const navigate = useNavigate();
  const ask = (q: string) => navigate(`/ai?ctx=${encodeURIComponent(ctx)}&q=${encodeURIComponent(q)}`);
  return (
    <div className="ask-ai">
      <span className="ask-ai-label">
        <span className="ai-orb small" /> KI
      </span>
      <div className="ask-ai-row">
        {prompts.map((p) => (
          <button key={p} className="ask-ai-chip" onClick={() => ask(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
