type Credentials = {
  id: string;
  secret: string;
};

type ApiError = {
  errorMessage?: string;
  message?: string;
  error?: { message?: string };
};

function errorMessage(data: ApiError, status: number) {
  return data.errorMessage || data.message || data.error?.message || `네이버 API 오류 (${status})`;
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text.slice(0, 200) };
  }
}

export function credentials(prefix: "SEARCH" | "SHOPPING" | "TREND"): Credentials {
  const id = process.env[`NAVER_${prefix}_CLIENT_ID`];
  const secret = process.env[`NAVER_${prefix}_CLIENT_SECRET`];
  if (!id || !secret) {
    throw new Error(`NAVER ${prefix} API 인증정보가 설정되지 않았습니다.`);
  }
  return { id, secret };
}

export async function naverPost<T>(
  hubPath: string,
  legacyPath: string,
  body: Record<string, unknown>,
  credential: Credentials,
): Promise<{ data: T; provider: "NAVER API HUB" | "NAVER Developers" }> {
  const attempts = [
    {
      provider: "NAVER API HUB" as const,
      url: `https://naverapihub.apigw.ntruss.com${hubPath}`,
      headers: {
        "X-NCP-APIGW-API-KEY-ID": credential.id,
        "X-NCP-APIGW-API-KEY": credential.secret,
      },
    },
    {
      provider: "NAVER Developers" as const,
      url: `https://openapi.naver.com${legacyPath}`,
      headers: {
        "X-Naver-Client-Id": credential.id,
        "X-Naver-Client-Secret": credential.secret,
      },
    },
  ];

  let lastError = "네이버 API 호출에 실패했습니다.";
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...attempt.headers,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await parseJson(response)) as T & ApiError;
    if (response.ok) return { data, provider: attempt.provider };
    lastError = errorMessage(data, response.status);
    if (![401, 403, 404].includes(response.status)) break;
  }
  throw new Error(lastError);
}

export async function naverSearch<T>(
  source: "blog" | "cafearticle",
  params: URLSearchParams,
  credential: Credentials,
): Promise<{ data: T; provider: "NAVER API HUB" | "NAVER Developers" }> {
  const attempts = [
    {
      provider: "NAVER API HUB" as const,
      url: `https://naverapihub.apigw.ntruss.com/search/v1/${source}?${params}`,
      headers: {
        "X-NCP-APIGW-API-KEY-ID": credential.id,
        "X-NCP-APIGW-API-KEY": credential.secret,
      },
    },
    {
      provider: "NAVER Developers" as const,
      url: `https://openapi.naver.com/v1/search/${source}.json?${params}`,
      headers: {
        "X-Naver-Client-Id": credential.id,
        "X-Naver-Client-Secret": credential.secret,
      },
    },
  ];

  let lastError = "네이버 검색 API 호출에 실패했습니다.";
  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      headers: attempt.headers,
      cache: "no-store",
    });
    const data = (await parseJson(response)) as T & ApiError;
    if (response.ok) return { data, provider: attempt.provider };
    lastError = errorMessage(data, response.status);
    if (![401, 403, 404].includes(response.status)) break;
  }
  throw new Error(lastError);
}

export function lastCompleteMonthRange(months = 12) {
  const end = new Date();
  end.setUTCDate(1);
  end.setUTCDate(0);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    timeUnit: "month",
  };
}

