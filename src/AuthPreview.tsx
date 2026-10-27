import { useState } from 'react'

type AuthPreviewProps = {
  page: 'signup' | 'forgot-password'
  onBack: () => void
}

function AuthField({ kind, label, id }: {
  kind: 'email' | 'username' | 'password'
  label: string
  id: string
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = kind === 'password'

  return (
    <div className={`login-field${isPassword ? ' password-field' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {kind === 'email' ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 6 9 7 9-7" />
          </>
        ) : kind === 'username' ? (
          <>
            <circle cx="12" cy="7" r="4" />
            <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
          </>
        ) : (
          <>
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <path d="M12 14v3" />
          </>
        )}
      </svg>
      <input
        id={id}
        name={id}
        type={isPassword ? (visible ? 'text' : 'password') : kind === 'email' ? 'email' : 'text'}
        aria-label={label}
        placeholder={label}
        autoComplete={isPassword ? 'new-password' : kind}
        required
      />
      {isPassword && (
        <button
          className="password-toggle"
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-controls={id}
          onClick={() => setVisible((value) => !value)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="m3 3 18 18" />}
          </svg>
        </button>
      )}
    </div>
  )
}

export default function AuthPreview({ page, onBack }: AuthPreviewProps) {
  const [submitted, setSubmitted] = useState(false)
  const isSignup = page === 'signup'

  return (
    <main className="login-page">
      <button className="sign-up" type="button" onClick={onBack}>back to login</button>
      <section className="login-panel" aria-labelledby="auth-title">
        <h1 className="title" id="auth-title">Steam Cooldown Tracker</h1>
        <h2 className="auth-heading">{isSignup ? 'sign up' : 'forgot password?'}</h2>
        <form
          className="login-form"
          id="auth-preview-form"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
          }}
        >
          <AuthField kind="email" label="email" id="signup-email" />
          {isSignup && (
            <>
              <AuthField kind="username" label="username" id="signup-username" />
              <AuthField kind="password" label="password" id="signup-password" />
              <AuthField kind="password" label="confirm password" id="signup-confirm-password" />
            </>
          )}
        </form>
        <div className="login-actions">
          <button className="login-button auth-submit" type="submit" form="auth-preview-form">
            {isSignup ? 'sign up' : 'reset password'}
          </button>
          <button className="forgot-password" type="button" onClick={onBack}>back to login</button>
        </div>
        <p className="auth-note" role="status">
          {submitted
            ? `${isSignup ? 'Account creation' : 'Password reset'} is not connected yet. No request was sent.`
            : 'Preview only — this form is not connected yet.'}
        </p>
      </section>
    </main>
  )
}
