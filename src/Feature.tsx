import { useEffect } from "react";
import {
  MeshNameInput,
  useNamedPeer,
  usePhase,
  useCommitRevealHook,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type Phase = "composing" | "committing" | "revealing" | "done";
type Vote = { vote: "yes" | "no" };

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="ballot-screen">
        <h1>secret ballot</h1>
        <p className="ballot-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const { name, setName } = useNamedPeer(config, room);
  const ph = usePhase<Phase>(room, "phase", "composing");
  const qMap = room.doc.getMap<string | number>("question");
  const round = (qMap.get("round") as number | undefined) ?? 0;
  const questionText = (qMap.get("text") as string | undefined) ?? "";
  const cr = useCommitRevealHook<Vote>(room, config.storagePrefix, `ballot-${round}`);

  useEffect(() => {
    if (ph.phase === "revealing" && cr.myHash && !cr.myReveal) {
      void cr.reveal();
    }
  }, [ph.phase, cr.myHash, cr.myReveal, cr]);

  const trimmed = name.trim();
  const present = room.peerCount + 1;
  const committed = Object.values(cr.entries).filter((e) => e.hash).length;
  const revealed = Object.values(cr.entries).filter((e) => e.reveal);
  const yes = revealed.filter((e) => e.reveal!.payload.vote === "yes").length;
  const no = revealed.filter((e) => e.reveal!.payload.vote === "no").length;

  const openBallot = () => {
    const t = questionText.trim() || "(no question)";
    qMap.set("text", t);
    ph.transition("committing", { from: "composing" });
  };

  const castVote = (v: "yes" | "no") => {
    if (cr.myHash) return;
    void cr.commit({ vote: v });
  };

  const revealAll = () => ph.transition("revealing", { from: "committing" });

  const nextBallot = () => {
    room.doc.transact(() => {
      qMap.set("round", round + 1);
      qMap.set("text", "");
    });
    ph.transition("composing");
  };

  return (
    <div className="ballot-screen">
      <header className="ballot-header">
        <h1>secret ballot</h1>
        <p className="ballot-status">
          round {round} · {present} {present === 1 ? "peer" : "peers"} · {ph.phase}
        </p>
      </header>

      <MeshNameInput
        className="ballot-name"
        value={name}
        onChange={setName}
        placeholder="your name"
        maxLength={48}
      />

      {ph.phase === "composing" && (
        <div className="ballot-compose">
          <textarea
            className="ballot-question-input"
            placeholder="the question"
            value={questionText}
            onChange={(e) => qMap.set("text", e.target.value)}
            disabled={!trimmed}
            rows={3}
          />
          <button
            type="button"
            className="ballot-open"
            onClick={openBallot}
            disabled={!trimmed}
            aria-label="open ballot"
          >
            open ballot
          </button>
        </div>
      )}

      {ph.phase === "committing" && (
        <div className="ballot-vote">
          <p className="ballot-question">{questionText}</p>
          <div className="ballot-buttons">
            <button
              type="button"
              className="ballot-yes"
              onClick={() => castVote("yes")}
              disabled={!trimmed || !!cr.myHash}
              aria-label="vote yes"
            >
              vote yes
            </button>
            <button
              type="button"
              className="ballot-no"
              onClick={() => castVote("no")}
              disabled={!trimmed || !!cr.myHash}
              aria-label="vote no"
            >
              vote no
            </button>
          </div>
          <p className="ballot-chip">
            {cr.myHash ? "you committed · " : ""}
            {committed} of {present} peers committed
          </p>
          <button
            type="button"
            className="ballot-reveal-all"
            onClick={revealAll}
            aria-label="reveal all"
          >
            reveal all
          </button>
        </div>
      )}

      {ph.phase === "revealing" && (
        <div className="ballot-reveal">
          <p className="ballot-question">{questionText}</p>
          <p className="ballot-tally">
            {yes} yes · {no} no ({revealed.length} of {committed} revealed)
          </p>
          <button
            type="button"
            className="ballot-next"
            onClick={nextBallot}
            aria-label="next ballot"
          >
            next ballot
          </button>
        </div>
      )}
    </div>
  );
}
