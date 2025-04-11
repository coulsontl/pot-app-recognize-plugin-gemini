async function recognize(base64, lang, options) {
    const { config, utils } = options;
    // const { tauriFetch } = utils;

    let { apiKey, modelName, customModelName, systemPrompt, userPrompt, useStream: use_stream = 'true', temperature = '0', topP = '0.95', apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta" } = config;

    if (!apiKey) {
        throw new Error("Please configure API Key first");
    }

    if (!apiBaseUrl) {
        throw new Error("Please configure Request Path first");
    }

    if (!/https?:\/\/.+/.test(apiBaseUrl)) {
        apiBaseUrl = `https://${apiBaseUrl}`;
    }
    const useStream = use_stream !== "false";

    // 处理模型选择
    let model = modelName || 'gemini-2.0-flash';
    if (modelName === 'custom') {
        model = customModelName || 'gemini-2.0-flash';
    }

    const apiUrl = new URL(`${apiBaseUrl}/models/${model}:${useStream ? 'streamGenerateContent' : 'generateContent'}?key=${apiKey}`);

    // 构建系统提示词 - 使用自定义提示词或默认提示词
    systemPrompt = (!systemPrompt || systemPrompt.trim() === "") ? undefined : systemPrompt;
    if (systemPrompt) {
        systemPrompt = systemPrompt.replace(/\$lang/g, lang);
    }

    // 如果用户提示词为空，使用默认提示词
    if (!userPrompt || userPrompt.trim() === "") {
        // 添加翻译指令
        userPrompt = `Just recognize the text in the image. Do not offer unnecessary explanations.`;
    }

    // 替换用户提示词中的变量
    userPrompt = userPrompt.replace(/\$lang/g, lang);

    const headers = useStream ? {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
    } : {
        "Content-Type": "application/json"
    };

    const body = {
        safetySettings: [
            {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE"
            },
            {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
            }
        ],
        ...(systemPrompt ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } } : {}),
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    { inline_data: { mime_type: "image/jpeg", data: base64 } }
                ]
            }
        ],
        generationConfig: {
            temperature: parseFloat(temperature),
            topP: parseFloat(topP),
        }
    }
    // return apiUrl.href;
    // return JSON.stringify(body);

    let res = await window.fetch(apiUrl.href, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
    });

    if (res.ok) {
        // 非流式输出
        if (!useStream) {
            let result = await res.json();
            // 处理Gemini API的响应格式
            if (result.candidates && result.candidates.length > 0) {
                const candidate = result.candidates[0];
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    let target = candidate.content.parts[0].text;
                    if (target) {
                        return target.trim();
                    }
                }
            }
            // 如果无法解析预期的响应格式，抛出错误
            throw new Error(`无法解析Gemini API的响应: ${JSON.stringify(result)}`);
        }

        // 流式输出
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let translatedText = '';
        let buffer = '';  // 用于存储跨块的不完整消息

        const processLines = (lines) => {
            for (const line of lines) {
                if (!line) continue;

                const trimmedLine = line.trim();
                if (trimmedLine === "" || trimmedLine === "data: [DONE]") continue; // 跳过结束标记

                // 检查是否是SSE格式（以data:开头）
                let jsonStr = line;
                if (line.startsWith("data:")) {
                    jsonStr = line.substring(5).trim();
                }

                // 解析JSON
                let parsedData;
                try {
                    parsedData = JSON.parse(jsonStr);
                } catch (e) {
                    continue;
                }

                // 处理Gemini API的流式响应格式
                if (parsedData.candidates && parsedData.candidates.length > 0) {
                    const candidate = parsedData.candidates[0];
                    if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                        const textPart = candidate.content.parts[0].text;
                        if (textPart) {
                            translatedText += textPart;
                            // setResult(translatedText);
                        }
                    }
                    else if (candidate.delta && candidate.delta.textDelta && candidate.delta.textDelta.text) {
                        // 处理增量文本更新格式
                        translatedText += candidate.delta.textDelta.text;
                        // setResult(translatedText);
                    }
                }
            }
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    // 确保处理完所有剩余数据
                    const remainingText = decoder.decode();
                    if (remainingText) buffer += remainingText;
                    break;
                }

                // 解码当前块并追加到缓冲区
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // 尝试处理完整的消息
                const lines = buffer.split('\n');
                // 保留最后一个可能不完整的部分
                buffer = lines.pop() || '';

                processLines(lines);
            }

            // 处理buffer中剩余的任何数据
            if (buffer) {
                const lines = buffer.split('\n');
                processLines(lines);
            }

            return translatedText;
        } catch (error) {
            throw `Streaming response processing error: ${error.message}`;
        }
    } else {
        throw new Error(`Http Request Error\nHttp Status: ${res.status}\n${await res.text()}`);
    }
}
