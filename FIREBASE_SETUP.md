# Firebase 설정 가이드

MY AI STUDIO에서 Google 로그인 및 Google Drive 연동을 사용하려면 Firebase 프로젝트 설정이 필요합니다.

## 📋 목차
1. [Firebase 프로젝트 생성](#1-firebase-프로젝트-생성)
2. [Google 인증 활성화](#2-google-인증-활성화)
3. [웹 앱 등록](#3-웹-앱-등록)
4. [환경 변수 설정](#4-환경-변수-설정)
5. [Google Drive API 활성화](#5-google-drive-api-활성화)
6. [OAuth 동의 화면 설정](#6-oauth-동의-화면-설정)

---

## 1. Firebase 프로젝트 생성

### 1.1 Firebase Console 접속
1. https://console.firebase.google.com/ 접속
2. Google 계정으로 로그인

### 1.2 프로젝트 만들기
1. **"프로젝트 추가"** 버튼 클릭
2. 프로젝트 이름 입력: `my-ai-studio` (또는 원하는 이름)
3. Google Analytics 사용 설정 (선택사항)
4. **"프로젝트 만들기"** 클릭

---

## 2. Google 인증 활성화

### 2.1 Authentication 설정
1. 왼쪽 메뉴에서 **"빌드" → "Authentication"** 클릭
2. **"시작하기"** 버튼 클릭

### 2.2 Google 로그인 활성화
1. **"Sign-in method"** 탭 선택
2. **"Google"** 클릭
3. **"사용 설정"** 토글 ON
4. 프로젝트 지원 이메일 선택
5. **"저장"** 클릭

---

## 3. 웹 앱 등록

### 3.1 앱 추가
1. Firebase 프로젝트 개요 페이지로 이동
2. **"웹 앱에 Firebase 추가"** (</> 아이콘) 클릭
3. 앱 닉네임 입력: `MY AI STUDIO Web`
4. **"Firebase Hosting 설정"** 체크 (선택사항)
5. **"앱 등록"** 클릭

### 3.2 구성 정보 복사
다음과 같은 형식의 설정 정보가 표시됩니다:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-ai-studio.firebaseapp.com",
  projectId: "my-ai-studio",
  storageBucket: "my-ai-studio.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};
```

**이 정보를 안전한 곳에 복사해두세요!**

---

## 4. 환경 변수 설정

### 4.1 로컬 개발 환경

프로젝트 루트 디렉토리에 `.env.local` 파일을 생성하고 다음 내용을 추가:

```env
# Gemini API Key (기존)
VITE_API_KEY=your-gemini-api-key-here

# Firebase Configuration
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=my-ai-studio.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=my-ai-studio
VITE_FIREBASE_STORAGE_BUCKET=my-ai-studio.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef...
```

### 4.2 Vercel 배포 환경

1. Vercel 프로젝트 대시보드 → **Settings** → **Environment Variables**
2. 다음 변수들을 추가:

| Name | Value |
|------|-------|
| `VITE_FIREBASE_API_KEY` | AIzaSy... |
| `VITE_FIREBASE_AUTH_DOMAIN` | my-ai-studio.firebaseapp.com |
| `VITE_FIREBASE_PROJECT_ID` | my-ai-studio |
| `VITE_FIREBASE_STORAGE_BUCKET` | my-ai-studio.appspot.com |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 123456789 |
| `VITE_FIREBASE_APP_ID` | 1:123456789:web:abcdef... |

3. **"Redeploy"** 실행하여 변경사항 적용

---

## 5. Google Drive API 활성화

### 5.1 Google Cloud Console 접속
1. https://console.cloud.google.com/ 접속
2. Firebase 프로젝트와 동일한 프로젝트 선택

### 5.2 Google Drive API 활성화
1. **"API 및 서비스" → "라이브러리"** 클릭
2. "Google Drive API" 검색
3. **"Google Drive API"** 선택
4. **"사용"** 버튼 클릭

---

## 6. OAuth 동의 화면 설정

### 6.1 OAuth 동의 화면 구성
1. Google Cloud Console → **"API 및 서비스" → "OAuth 동의 화면"**
2. 사용자 유형: **"외부"** 선택
3. **"만들기"** 클릭

### 6.2 앱 정보 입력
- **앱 이름:** MY AI STUDIO
- **사용자 지원 이메일:** 본인 이메일
- **개발자 연락처 정보:** 본인 이메일
- **"저장 후 계속"** 클릭

### 6.3 범위 추가
1. **"범위 추가 또는 삭제"** 클릭
2. 다음 범위를 검색하여 추가:
   - `.../auth/drive.file` (앱이 생성하거나 연 파일에 대한 액세스)
   - `.../auth/drive.appdata` (애플리케이션 데이터 폴더 액세스)
3. **"업데이트"** → **"저장 후 계속"** 클릭

### 6.4 테스트 사용자 추가 (선택사항)
- 앱이 "테스트" 모드인 경우, 테스트 사용자로 본인 이메일 추가
- **"저장 후 계속"** 클릭

---

## 7. 승인된 도메인 추가

### 7.1 Firebase Console에서 도메인 추가
1. Firebase Console → **Authentication** → **Settings** → **승인된 도메인**
2. 다음 도메인 추가:
   - `localhost` (로컬 개발용)
   - `your-vercel-domain.vercel.app` (Vercel 배포용)

---

## 🎉 완료!

설정이 완료되었습니다. 이제 앱을 실행하고 Google 로그인을 테스트해보세요.

### 테스트 방법

1. **로컬 개발:**
   ```bash
   npm run dev
   ```

2. 브라우저에서 http://localhost:3000 접속

3. 헤더의 **"로그인"** 버튼 클릭

4. Google 계정으로 로그인

5. Drive 권한 동의 확인

---

## ⚠️ 문제 해결

### "Firebase is not configured" 오류
- `.env.local` 파일에 모든 환경 변수가 올바르게 설정되었는지 확인
- 개발 서버를 재시작 (`npm run dev`)

### "팝업이 차단되었습니다" 오류
- 브라우저 팝업 차단 해제
- Chrome 설정 → 개인정보 및 보안 → 사이트 설정 → 팝업 및 리디렉션

### "Invalid API Key" 오류
- Firebase Console에서 API 키 확인
- 환경 변수가 올바르게 설정되었는지 확인

### Google Drive 권한 오류
- Google Cloud Console에서 Drive API가 활성화되었는지 확인
- OAuth 동의 화면에서 범위가 추가되었는지 확인

---

## 📚 참고 자료

- [Firebase Authentication 문서](https://firebase.google.com/docs/auth)
- [Google Drive API 문서](https://developers.google.com/drive/api/guides/about-sdk)
- [Firebase + Google Sign-In 가이드](https://firebase.google.com/docs/auth/web/google-signin)

---

## 🔐 보안 주의사항

1. **API 키 노출 방지**
   - `.env.local` 파일은 절대 GitHub에 커밋하지 마세요
   - `.gitignore`에 `*.local` 패턴이 포함되어 있는지 확인

2. **프로덕션 배포 시**
   - Firebase Security Rules 설정
   - 승인된 도메인만 허용
   - API 키 사용량 모니터링

3. **OAuth Scopes**
   - 필요한 최소한의 권한만 요청
   - 사용자에게 권한 사용 목적 명확히 안내
