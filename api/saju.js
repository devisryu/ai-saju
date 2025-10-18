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
  const intentMap = { today:'오늘 운세', month:'한달 운세', wealth:'재물운', love:'연애/결혼운', match:'궁합' };
  const intent = intentMap[type] || '오늘 운세';
  const base = `당신은 한국 사용자를 위한 사주 해석가입니다. 반드시 한국어로 짧고 명확하게 답합니다.
- 입력: 생년월일, 태어난 시간(모르면 00:00), 시간대(${tz}).
- 출력은 마크다운 없이 순수 텍스트.
- 금지: 의료/법률/투자 확정 조언, 미신 강요, 개인정보 추가 수집 유도.
- 톤: 차분하고 현실적인 조언 2~3가지 포함.
- 길이: 400~700자.
- 요청 범위를 넘는 질문은 거절(사주 관련 범주만).
- 로또/복권은 반드시 엔터테인먼트용 문구 포함.`;
  const ask = type === 'match'
    ? `${intent}을 간결히 설명. 두 사람
A: ${birthDate} ${birthTime}
B: ${partnerDate || '미입력'} ${partnerTime || '00:00'}
궁합 포인트(소통, 가치관, 갈등관리)와 유의점 2~3개, 좋은 날짜 힌트 1개.`
    : `${intent}을 간결히 설명.
대상: ${birthDate} ${birthTime}
핵심 운세 요약 3줄 → 세부 4~6줄 → 마무리 1줄(현실 조언).`;
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
