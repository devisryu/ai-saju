// api/saju.js

function send(res, code, payload) {
  try { res.status(code).json(payload); }
  catch {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }
}

function buildPrompt({ type, birthDate, birthTime, partnerDate, partnerTime, tz }) {
  const intentMap = {
    today: '오늘 운세',
    month: '한달 운세',
    nextyear: '내년 운세', 
    wealth: '재물운',
    love: '연애/결혼운',
    match: '궁합',
  };
  const intent = intentMap[type] || '오늘 운세';

  // 공통 가드라인: 친절하지만 과장 없이, 현실 조언 포함
  const base = `당신은 한국 사용자를 위한 사주 해석가입니다. 반드시 한국어로 친절하고 차분하게 답합니다.
- 입력: 생년월일, 태어난 시간(모르면 00:00), 시간대(${tz}).
- 출력: 마크다운 없이 순수 텍스트. 핵심 → 이유 → 현실 조언 순서로 간결하게.
- 금지: 의료/법률/투자 확정 조언, 미신 강요, 개인정보 추가 수집 유도.
- 톤: 위로와 격려를 담되, 과장이나 단정은 피함. 실행 가능한 작은 조언 2~3개 포함.
- 길이: 400~700자.
- 요청 범위를 넘는 질문은 정중히 거절(사주 관련 범주만).
- 로또/복권 관련 언급은 반드시 "엔터테인먼트 목적" 문구 포함.`;

  // 의도별 요청문
  const ask =
    type === 'match'
      ? `${intent}을 따뜻하고 현실적으로 설명하세요.
두 사람 정보
A: ${birthDate} ${birthTime}
B: ${partnerDate || '미입력'} ${partnerTime || '00:00'}
1) 소통 스타일  2) 가치관/생활리듬  3) 갈등 포인트와 해결 팁(구체적 행동 2~3개)
마지막에 서로에게 도움이 되는 한 문장 조언과, 가볍게 참고할 만한 좋은 타이밍 힌트 1개를 덧붙이세요.`

      : type === 'nextyear'
      ? `다가오는 ${new Date().getFullYear() + 1}년의 전체 운세를 카테고리별로 자세히 설명하세요.
대상: ${birthDate} ${birthTime}
형식:
- 총평: 2~3줄로 분위기와 키워드
- 건강: 2~3줄(생활습관/컨디션 관리 팁 1~2개)
- 학업/직장: 2~3줄(집중할 분야·관계 팁)
- 재물: 2~3줄(지출·저축·투자 시 유의점, 복권은 엔터테인먼트 목적)
- 사랑: 2~3줄(솔로/커플 모두에게 적용 가능한 실천 팁)
마지막에 한 문장으로 내년에 도움이 될 간단한 루틴을 제안하세요.`

      : `${intent}을 친절하고 명확하게 설명하세요.
대상: ${birthDate} ${birthTime}
먼저 핵심 요약 3줄을 제시하고,
이어 세부 해석 4~6줄(이유와 상황별 팁 포함),
마지막에 오늘/이번 달에 바로 적용할 수 있는 현실 조언 1줄을 덧붙이세요.`;

  return `${base}\n\n${ask}`;
}


export default async function handler(req, res) {
  // 간단 헬스체크: GET /api/saju?health=1
  if (req.method === 'GET' && req.query?.health === '1') {
    return send(res, 200, { ok: true, hasKey: !!process.env.OPENAI_API_KEY });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  try {
    const {
      type = 'today',
      birthDate,
      birthTime = '00:00',
      partnerDate,
      partnerTime = '00:00',
      tz = 'Asia/Seoul',
    } = req.body || {};

    if (!birthDate) return send(res, 400, { error: 'birthDate required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return send(res, 500, { error: 'OPENAI_API_KEY missing (check Preview/Production env)' });

    const prompt = buildPrompt({ type, birthDate, birthTime, partnerDate, partnerTime, tz });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a concise Korean fortune interpreter (사주). Stay strictly on topic.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
    });

    const textBody = await resp.text(); // 원문 확보
    let data;
    try { data = JSON.parse(textBody); } catch { data = null; }

    if (!resp.ok) {
      return send(res, 502, {
        error: 'OpenAI request failed',
        status: resp.status,
        raw: textBody,     // 에러 원문 (model 권한/잔액/형식 오류 등)
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return send(res, 502, { error: 'Empty completion', raw: textBody });

    return send(res, 200, { text });
  } catch (e) {
    return send(res, 500, { error: e?.message || 'Server error' });
  }
}
