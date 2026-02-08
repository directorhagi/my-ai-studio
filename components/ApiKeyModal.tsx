
import React, { useState } from 'react';

interface ApiKeyModalProps {
  onSave: (apiKey: string) => void;
  isDarkMode?: boolean;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave, isDarkMode = true }) => {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!apiKey.trim()) {
      setError('API 키를 입력해주세요');
      return;
    }

    if (apiKey.length < 20) {
      setError('유효한 API 키를 입력해주세요');
      return;
    }

    onSave(apiKey.trim());
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-md mx-4 bg-gradient-to-br from-slate-900 to-black border border-white/10 rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-300">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-indigo-500/10 border border-indigo-500/20">
            <i className="fas fa-key text-2xl text-indigo-400"></i>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">API 키 설정</h2>
          <p className="text-sm text-slate-400">
            MY AI STUDIO를 사용하려면 Gemini API 키가 필요합니다
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError('');
              }}
              placeholder="AIza..."
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
              autoFocus
            />
            {error && (
              <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
                <i className="fas fa-exclamation-circle"></i>
                {error}
              </p>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-xs text-blue-200 mb-2">
              <i className="fas fa-info-circle mr-1"></i>
              API 키 발급 방법:
            </p>
            <ol className="text-xs text-slate-300 space-y-1 ml-4 list-decimal">
              <li>
                <a
                  href="https://aistudio.google.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 underline"
                >
                  Google AI Studio
                </a>
                에 접속
              </li>
              <li>"Create API Key" 클릭</li>
              <li>발급받은 키를 위에 입력</li>
            </ol>
          </div>

          {/* Privacy Notice */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <p className="text-xs text-green-200 flex items-start gap-2">
              <i className="fas fa-shield-alt mt-0.5"></i>
              <span>
                API 키는 브라우저(localStorage)에만 저장되며, 서버로 전송되지 않습니다. 안전합니다.
              </span>
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-indigo-500/50 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <i className="fas fa-save mr-2"></i>
            저장하고 시작하기
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-slate-500">
          API 키는 언제든지 Settings에서 변경할 수 있습니다
        </p>
      </div>
    </div>
  );
};

export default ApiKeyModal;
