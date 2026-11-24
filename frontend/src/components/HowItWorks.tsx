export function HowItWorks() {
  return (
    <div className="stack" style={{ gap: 40 }}>
      <div className="explain">
        <article>
          <h2>Where the leak comes from</h2>
          <p>
            The vulnerable login compares your guess to the PIN one digit at a time and gives up at the
            first mismatch. A guess with the right first digit gets one step further before failing, so
            it takes a little longer to reject.
          </p>
          <pre className="code"><code>{`def insecure_compare(guess, secret):
    for g, s in zip(guess, secret):
        if g != s:
`}<span className="hl-leak">{`            return False   # exits early`}</span>{`
    return True`}</code></pre>
          <p>
            That small difference turns one hard question (which of 1,000,000 PINs?) into six easy ones
            (which of 10 digits is slowest?). Six digits need about 60 groups of guesses instead of a
            million.
          </p>
        </article>
        <article>
          <h2>The patch</h2>
          <p>
            The constant-time login uses Python's <code>hmac.compare_digest</code>. It always looks at
            every byte before answering, so the time it takes does not depend on how much of the guess is
            right.
          </p>
          <pre className="code"><code>{`import hmac

def secure_compare(guess, secret):
`}<span className="hl-safe">{`    return hmac.compare_digest(
        guess.encode(), secret.encode())`}</span></code></pre>
          <p>
            It is a one-line change with no measurable cost to real users: the whole compare takes around a
            microsecond either way.
          </p>
        </article>
      </div>

      <article className="explain" style={{ gridTemplateColumns: "1fr" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <h2>Other defences and what they cost</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Defence</th><th>Stops the attack?</th><th>Cost to real users</th></tr>
              </thead>
              <tbody>
                <tr><td>Constant-time compare</td><td>Yes. Removes the leak itself.</td><td>None worth measuring.</td></tr>
                <tr><td>Random jitter</td><td>No. More samples average the noise away.</td><td>Every login gets slower.</td></tr>
                <tr><td>Rate limiting</td><td>Slows it down, does not fix it.</td><td>Legitimate bursts get refused.</td></tr>
                <tr><td>Lockout after failures</td><td>Yes, in practice: the attack needs hundreds of wrong guesses.</td><td>Anyone can lock a real user out on purpose.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <div className="explain">
        <article>
          <h2>What the attacker can and cannot do</h2>
          <ul>
            <li>Can send as many login guesses as the server allows, and time every reply.</li>
            <li>Knows how the server works, the PIN length and that it is digits only.</li>
            <li>Cannot read server memory or source, and cannot change the server.</li>
          </ul>
        </article>
        <article>
          <h2>About the leak amplifier</h2>
          <p>
            A real early-exit compare leaks only nanoseconds per digit, which is hard to see through network
            noise. The amplifier adds a few milliseconds per matched digit so the effect is visible in a
            classroom over Wi-Fi. Switch on server-side timing and set the amplifier to 0 to study the raw leak.
          </p>
        </article>
      </div>
    </div>
  );
}
