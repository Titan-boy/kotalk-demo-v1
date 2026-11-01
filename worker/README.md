# kotalk-judge — 회화 답변 AI 판정 서버 (Cloudflare Worker)

KoTalk의 회화 연습에서 학습자 답변을 Claude가 판정하도록 중계하는 작은 서버입니다.

```
브라우저(GitHub Pages) ──POST /judge──▶ 이 Worker ──▶ Claude API
                                        (API 키는 여기에만 있음)
```

- 공개 사이트에 API 키를 넣으면 누구나 볼 수 있으므로, 키는 이 Worker의 secret에만 둡니다.
- 사이트의 `config.js`의 `aiEndpoint`가 비어 있으면 AI 판정은 꺼지고, 기존 간이 판정(문장 끝·키워드)으로 동작합니다.
- AI 연결이 실패해도 그 답변은 간이 판정으로 처리되므로 회화가 멈추지 않습니다.

## 설치 순서 (처음 한 번)

1. **Claude API 키 발급**: https://platform.claude.com 에서 API 키를 만들고, **월 사용 한도(spend limit)**를 꼭 설정합니다.
2. **Cloudflare 계정**: https://dash.cloudflare.com 에서 무료 계정을 만듭니다.
3. 이 폴더에서 아래 명령을 차례로 실행합니다(Node.js 20 이상).

```bash
cd worker
```

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

```bash
npx wrangler deploy
```

4. `deploy`가 끝나면 `https://kotalk-judge.<계정명>.workers.dev` 같은 주소가 나옵니다. 저장소 루트의 `config.js`에 **끝에 `/judge`를 붙여** 넣고 main에 반영합니다.

```js
aiEndpoint: "https://kotalk-judge.<계정명>.workers.dev/judge"
```

5. 휴대폰에서 사이트를 열고 설정(⚙️) → 「AI判定」 → 「AIへの接続を確認する」를 누릅니다. 「AIに接続できました」가 나오면 끝입니다.

## 판정 방식

`src/judge.js`의 프롬프트로 다음을 받습니다.

| 항목 | 내용 |
|---|---|
| `verdict` | `ok`(통함) / `almost`(뜻은 짐작되지만 장면에 안 맞음·필수 표현 없음) / `ng`(답이 아님) |
| `feedback_ja` | 일본어 1~2문장 조언(학습자가 일본인이므로 설명은 전부 일본어) |
| `corrected_ko` | 학습자의 뜻을 살려 고친 문장(띄어쓰기 수정 포함) |
| `better_ko` | 다른 자연스러운 표현 |

- 준비된 답과 내용이 달라도(영화 대신 쇼핑 등) 장면에 맞으면 `ok`입니다.
- 질문에 답하지 않은 답변(「뭐 해요?」에 「안녕하세요」)은 `ok`가 되지 않습니다. 이 부분이 기존 간이 판정의 한계였습니다.
- 녹음 답변은 브라우저 음성 인식으로 만든 문자를 판정하고, 오인식 가능성을 프롬프트에 알려 줍니다.

## 모델과 비용 (추정)

- 모델: `claude-haiku-5-5`, effort `low` (`src/judge.js`의 `MODEL`). 단가: 입력 $0.10 / 출력 $0.50 (100만 토큰당).
- 답변 1회: 입력 약 1,300토큰 + 출력 약 500토큰(판단 과정 포함, 넉넉하게 잡음) → **약 $0.0004 ≈ 0.06엔**.
- 20분 사용 = 답변 약 30회로 가정(답변 1회에 상대 음성·조언 읽기 포함 약 40초).

| 매일 20분 사용자 | 하루 | 한 달(30일) |
|---|---|---|
| 1명 | 약 1.8엔 | 약 54엔 |
| 10명 | 약 18엔 | 약 540엔 |
| 100명 | 약 180엔 | 약 5,400엔 |
| 1,000명 | 약 1,800엔 | 약 54,000엔 |

(1달러 = 150엔 기준. 답변을 더 자주 보내는 사용자(20분에 60회)라면 위 금액의 약 2배.)

- **실제 토큰 수는 측정해서 확인하세요.** Worker가 요청마다 사용 토큰을 로그에 남깁니다(답변 문장은 남기지 않음). `npx wrangler tail`로 보거나, Console의 사용량 화면에서 확인합니다.
- Cloudflare Workers 무료 플랜은 하루 10만 요청까지입니다. 1,000명 × 30회 = 하루 3만 요청이라 무료 범위 안입니다. 넘으면 유료 플랜(월 $5~)이 필요합니다.
- Haiku에는 거절 시 자동 대체 모델 기능이 없습니다. 거절되면 그 답변만 사이트의 간이 판정으로 처리됩니다.
- 판정 품질이 부족하면 `MODEL`을 `claude-sonnet-5-5`(약 20배) 또는 `claude-opus-5-5`(약 40배)로 바꿀 수 있습니다.

## 보안 주의

- `wrangler.toml`의 `ALLOWED_ORIGINS`에 있는 사이트에서 온 요청만 받습니다. 다만 Origin 헤더는 브라우저 밖에서 위조할 수 있으므로 **완전한 차단은 아닙니다.** 반드시 Console에서 사용 한도를 설정하고, 필요하면 Cloudflare의 Rate Limiting 규칙을 추가하세요.
- 요청 크기(8KB)와 각 항목 길이를 제한합니다.
- 학습자의 답변 문장(한국어)이 Claude API로 전송됩니다. 사이트 설정 화면에도 이 내용을 적어 두었습니다.

## 확인 스크립트

Claude API에 접속하지 않고 요청 형태·CORS·입력 검사를 확인합니다.

```bash
npm run check
```
