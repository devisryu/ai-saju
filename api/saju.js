// api/saju.js  — Vercel Serverless Function (Node 스타일)

function buildPrompt({ type, birthDate, birthTime, partnerDate, partnerTime, tz }) {
  const intentMap = {
    today: '오늘 운세',
    month: '한달 운세',
    wealth: '재물운',
    love: '연애/결혼운',
    match: '궁합',
  };
  const intent = intentMap[type] || '오늘 운세';

  const base = `당신은 한국 사용자를 위한 사주 해석가입니다. 반드시 한국어로 짧고 명확하게 답합니다.
- 입력: 생년월일, 태어난 시간(모르면 00:00), 시간대(${tz}).
- 출력은 마크다운 없이 순수 텍스트.
- 금지: 의료/법률/투자 확정 조언, 미신 강요, 개인 정보 수집 유도.
- 톤: 차분하고 현실적인 조언 2~3가지 포함.
- 길이: 400~700자.
- 요청 범위를 넘는 질문은 거절(사주 관련 범주만).
- 로또/복권은 반드시 엔터테인먼트용 문구 포함.
`;

  const ask =
    type === 'match'
      ? `${intent}을 간결히 설명. 두 사람
A: ${birthDate} ${birthTime}
B: ${partnerDate} ${partnerTime}
궁합 포인트(소통, 가치관, 갈등관리)와 유의점 2~3개, 좋은 날짜 힌트 1개.`
      : `${intent}을 간결히 설명.
대상: ${birthDate} ${birthTime}
핵심 운세 요약 3줄 → 세부 4~6줄 → 마무리 1줄(현실 조언).`;

  return `${base}\n${ask}`;
}

export default async function handler(req, res) {
  // CORS(필요 시)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      type,
      birthDate,
      birthTime = '00:00',
      partnerDate,
      partnerTime = '00:00',
      tz = 'Asia/Seoul',
    } = req.body || {};

    if (!birthDate) {
      return res.status(400).json({ error: 'birthDate required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: 'Server misconfig: OPENAI_API_KEY missing' });
    }

    const prompt = buildPrompt({
      type,
      birthDate,
      birthTime,
      partnerDate,
      partnerTime,
      tz,
    });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a concise Korean fortune interpreter (사주). Stay strictly on topic.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({ error: 'OpenAI error', detail: data });
    }

    const text =
      data.choices?.[0]?.message?.content?.trim() ||
      '해석을 가져오지 못했습니다.';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}
