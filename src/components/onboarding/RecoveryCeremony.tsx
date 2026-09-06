import { useMemo, useState } from "react";
import {
  generateRecoveryPhrase,
  recoveryNotice,
} from "../../services/auth/recovery";
export function recoveryDownload(username: string, words: string[]) {
  return `OFF recovery phrase\nAccount: ${username}\nCreated: ${new Date().toISOString()}\n\n${words.map((word, index) => `${String(index + 1).padStart(2, "0")}. ${word}`).join("\n")}\n\nAnyone who has this recovery phrase may be able to recover the account. Store it offline and never share it.\n${recoveryNotice}\n`;
}
export function RecoveryCeremony({
  username,
  onContinue,
}: {
  username: string;
  onContinue: () => void;
}) {
  const phrase = useMemo(() => generateRecoveryPhrase(), []),
    [confirmed, setConfirmed] = useState(false);
  const download = () => {
    const blob = new Blob([recoveryDownload(username, phrase)], {
        type: "text/plain",
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "off-recovery-phrase.txt";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="auth recovery">
      <section>
        <p className="eyebrow">KEEP OFFLINE · RECOVERY v0</p>
        <h1>Your recovery phrase.</h1>
        <p>
          Anyone who has this recovery phrase may be able to recover the
          account. Store it offline and never share it.
        </p>
        <ol>
          {phrase.map((word, index) => (
            <li key={`${index}-${word}`}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              {word}
            </li>
          ))}
        </ol>
        <div className="actions">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(phrase.join(" "))}
          >
            Copy
          </button>
          <button type="button" onClick={download}>
            Download
          </button>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          I have securely stored my recovery phrase.
        </label>
        <button className="primary" disabled={!confirmed} onClick={onContinue}>
          Continue <span>→</span>
        </button>
        <p className="fine">{recoveryNotice}</p>
      </section>
    </main>
  );
}
