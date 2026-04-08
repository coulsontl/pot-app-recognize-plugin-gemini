async function recognize(base64, lang, options) {
    const { config, utils } = options;
    // const { tauriFetch } = utils;

    function detectMimeTypeFromBase64(base64Data) {
        if (!base64Data || typeof base64Data !== "string") {
            return "image/jpeg";
        }

        const data = base64Data.trim().replace(/\s/g, "");

        // 常见图片格式 magic header 的 base64 特征
        if (data.startsWith("/9j/")) return "image/jpeg";
        if (data.startsWith("iVBORw0KGgo")) return "image/png";
        if (data.startsWith("R0lGOD")) return "image/gif";
        if (data.startsWith("UklGR")) return "image/webp";
        if (data.startsWith("Qk")) return "image/bmp";

        return "image/jpeg";
    }

    function normalizeBase64Image(base64Input, defaultMimeType = "image/jpeg") {
        if (!base64Input || typeof base64Input !== "string") {
            throw new TypeError("base64Input 必须是非空字符串");
        }

        let input = base64Input.trim().replace(/\s/g, "");

        // 如果传进来的是 data URL
        const dataUrlMatch = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

        if (dataUrlMatch) {
            let [, mimeType, data] = dataUrlMatch;

            if (mimeType === "image/jpg") {
                mimeType = "image/jpeg";
            }

            return {
                normalized: `data:${mimeType};base64,${data}`,
                mime_type: mimeType,
                data,
            };
        }

        // 简单校验纯 base64
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(input);
        if (!isBase64) {
            throw new Error("输入不是合法的 base64 图片数据");
        }

        const detectedMimeType = detectMimeTypeFromBase64(input) || defaultMimeType;

        return {
            normalized: `data:${detectedMimeType};base64,${input}`,
            mime_type: detectedMimeType,
            data: input,
        };
    }

    let {
        apiKey,
        modelName,
        customModelName,
        systemPrompt,
        userPrompt,
        thinkingBudget,
        requestArguments,
        useStream: use_stream = "true",
        temperature = "0",
        topP = "0.95",
        apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta"
    } = config;

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

    let model = modelName || "gemini-2.5-flash";
    if (modelName === "custom") {
        model = customModelName || "gemini-2.5-flash";
    }

    const apiUrl = new URL(
        `${apiBaseUrl}/models/${model}:${useStream ? "streamGenerateContent" : "generateContent"}?key=${apiKey}`
    );

    systemPrompt = (!systemPrompt || systemPrompt.trim() === "") ? undefined : systemPrompt;
    if (systemPrompt) {
        systemPrompt = systemPrompt.replace(/\$lang/g, lang);
    }

    if (!userPrompt || userPrompt.trim() === "") {
        userPrompt = "Just recognize the text in the image. Do not offer unnecessary explanations.";
    }

    userPrompt = userPrompt.replace(/\$lang/g, lang);

    const headers = useStream
        ? {
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        }
        : {
            "Content-Type": "application/json"
        };

    let otherConfigs = {};

    if (thinkingBudget && String(thinkingBudget).trim() !== "") {
        otherConfigs = {
            thinkingConfig: {
                thinkingBudget: parseInt(thinkingBudget, 10)
            }
        };
    }

    if (requestArguments && requestArguments.trim() !== "") {
        try {
            const parsedArgs = JSON.parse(requestArguments);
            if (parsedArgs.thinkingConfig) {
                otherConfigs = parsedArgs;
            } else {
                otherConfigs = {
                    ...otherConfigs,
                    ...parsedArgs
                };
            }
        } catch (e) {
            console.error(`Invalid requestArguments: ${e.message}`);
        }
    }

    const imageData = normalizeBase64Image(base64);

    const body = {
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ],
        ...(systemPrompt
            ? {
                systemInstruction: {
                    role: "system",
                    parts: [{ text: systemPrompt }]
                }
            }
            : {}),
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mime_type: imageData.mime_type,
                            data: imageData.data
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: parseFloat(temperature),
            topP: parseFloat(topP),
            ...otherConfigs,
        }
    };

    const res = await window.fetch(apiUrl.href, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (res.ok) {
        if (!useStream) {
            const result = await res.json();

            if (result.candidates && result.candidates.length > 0) {
                const candidate = result.candidates[0];
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    const target = candidate.content.parts[0].text;
                    if (target) {
                        return target.trim();
                    }
                }
            }

            throw new Error(`无法解析Gemini API的响应: ${JSON.stringify(result)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let translatedText = "";
        let buffer = "";

        const processLines = (lines) => {
            for (const line of lines) {
                if (!line) continue;

                const trimmedLine = line.trim();
                if (trimmedLine === "" || trimmedLine === "data: [DONE]") continue;

                let jsonStr = trimmedLine;
                if (trimmedLine.startsWith("data:")) {
                    jsonStr = trimmedLine.slice(5).trim();
                }

                let parsedData;
                try {
                    parsedData = JSON.parse(jsonStr);
                } catch (e) {
                    continue;
                }

                if (parsedData.candidates && parsedData.candidates.length > 0) {
                    const candidate = parsedData.candidates[0];

                    if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                        for (const part of candidate.content.parts) {
                            if (part.text) {
                                translatedText += part.text;
                            }
                        }
                    } else if (
                        candidate.delta &&
                        candidate.delta.textDelta &&
                        candidate.delta.textDelta.text
                    ) {
                        translatedText += candidate.delta.textDelta.text;
                    }
                }
            }
        };

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    const remainingText = decoder.decode();
                    if (remainingText) buffer += remainingText;
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                processLines(lines);
            }

            if (buffer) {
                processLines(buffer.split("\n"));
            }

            return translatedText;
        } catch (error) {
            throw new Error(`Streaming response processing error: ${error.message}`);
        }
    } else {
        throw new Error(`Http Request Error\nHttp Status: ${res.status}\n${await res.text()}`);
    }
}
