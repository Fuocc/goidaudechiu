import { SignIn } from '@clerk/clerk-react';
import '../styles/login.css';

function Login() {
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
        </div>
        <SignIn
          appearance={{
            variables: {
              colorPrimary: '#000000', // Minimalist modern black for buttons
              colorBackground: '#ffffff', // Clean white background for the card
              colorText: '#0f172a', // Slate-900 for sharp clear text
              colorTextSecondary: '#475569', // Slate-600 for descriptions
              colorInputBackground: '#ffffff',
              colorInputText: '#0f172a',
              colorBorder: '#cbd5e1', // Slate-300 borders
            },
            elements: {
              card: {
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '40px 32px',
                width: '100%',
                maxWidth: '400px',
              },
              headerTitle: {
                fontSize: '22px',
                fontWeight: '700',
                color: '#0f172a',
                fontFamily: 'inherit',
              },
              headerSubtitle: {
                color: '#475569',
                fontFamily: 'inherit',
              },
              socialButtonsBlockButton: {
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                borderRadius: '6px',
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: '#f8fafc',
                  borderColor: '#94a3b8',
                }
              },
              socialButtonsBlockButtonText: {
                color: '#0f172a',
                fontWeight: '500',
              },
              dividerLine: {
                backgroundColor: '#e2e8f0',
              },
              dividerText: {
                color: '#475569',
              },
              formFieldLabel: {
                color: '#334155',
                fontWeight: '500',
              },
              formInput: {
                borderColor: '#cbd5e1',
                borderRadius: '6px',
                '&:focus': {
                  borderColor: '#000000',
                }
              },
              formButtonPrimary: {
                borderRadius: '6px',
                fontWeight: '600',
                padding: '12px',
                textTransform: 'none',
                fontSize: '15px',
                backgroundColor: '#000000',
                color: '#ffffff',
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: '#1e293b',
                }
              },
              footerActionText: {
                color: '#475569',
              },
              footerActionLink: {
                color: '#000000',
                fontWeight: '600',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                '&:hover': {
                  color: '#334155',
                }
              },
              identityPreviewText: {
                color: '#0f172a',
              },
              identityPreviewEditButtonIcon: {
                color: '#000000',
              },
              footer: {
                display: 'none',
              }
            }
          }}
        />
      </div>
    </div>
  );
}

export default Login;
