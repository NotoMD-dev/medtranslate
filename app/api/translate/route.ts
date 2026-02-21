import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { text, systemPrompt, model } = await request.json();

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  try {
    // Route to appropriate API based on model
    if (model?.startsWith("claude")) {
      return await translateWithAnthropic(text, systemPrompt, model);
    } else {
      return await translateWithOpenAI(text, systemPrompt, model);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function translateWithOpenAI(
  text: string,
  systemPrompt: string,
  model: string
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  const translation = data.choices?.[0]?.message?.content?.trim() || "";
  return NextResponse.json({ translation });
}

async function translateWithAnthropic(
  text: string,
  systemPrompt: string,
  model: string
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  const translation =
    data.content
      ?.map((b: { type: string; text?: string }) => b.text || "")
      .join("") || "";
  return NextResponse.json({ translation });
}
