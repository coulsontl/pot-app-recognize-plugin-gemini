async function recognize(base64, lang, options) {
    const { config, utils } = options;
    // const { tauriFetch } = utils;

    function normalizeBase64Image(base64Input, defaultMimeType = "image/jpeg") {
        if (!base64Input || typeof base64Input !== "string") {
            throw new TypeError("base64Input 必须是非空字符串");
        }

        let input = base64Input.trim().replace(/\s/g, "");

        // 匹配 data URL，例如：
        // data:image/jpeg;base64,xxxx
        const dataUrlMatch = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);

        if (dataUrlMatch) {
            let [, mimeType, data] = dataUrlMatch;

            // 兼容 image/jpg
            if (mimeType === "image/jpg") {
                mimeType = "image/jpeg";
            }

            return {
                normalized: `data:${mimeType};base64,${data}`,
                mime_type: mimeType,
                data,
            };
        }

        // 纯 base64 校验
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(input);
        if (!isBase64) {
            throw new Error("输入不是合法的 base64 图片数据");
        }

        // 如果不是 data URL，则自动补默认前缀
        return {
            normalized: `data:${defaultMimeType};base64,${input}`,
            mime_type: defaultMimeType,
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

    // 处理模型选择
    let model = modelName || "gemini-2.5-flash";
    if (modelName === "custom") {
        model = customModelName || "gemini-2.5-flash";
    }

    const apiUrl = new URL(
        `${apiBaseUrl}/models/${model}:${useStream ? "streamGenerateContent" : "generateContent"}?key=${apiKey}`
    );

    // 构建系统提示词
    systemPrompt = (!systemPrompt || systemPrompt.trim() === "") ? undefined : systemPrompt;
    if (systemPrompt) {
        systemPrompt = systemPrompt.replace(/\$lang/g, lang);
    }

    // 如果用户提示词为空，使用默认提示词
    if (!userPrompt || userPrompt.trim() === "") {
        userPrompt = "Just recognize the text in the image. Do not offer unnecessary explanations.";
    }

    // 替换用户提示词中的变量
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

    // 处理推理长度
    if (thinkingBudget && String(thinkingBudget).trim() !== "") {
        otherConfigs = {
            thinkingConfig: {
                thinkingBudget: parseInt(thinkingBudget, 10)
            }
        };
    }

    // 处理其他参数配置
    if (requestArguments && requestArguments.trim() !== "") {
        try {
            const parsedArgs = JSON.parse(requestArguments);

            // 优先使用 requestArguments 中的 thinkingConfig
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

    // 规范化图片 base64
    const imageData = normalizeBase64Image(base64, "image/jpeg");

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
            // https://ai.google.dev/gemini-api/docs/thinking?hl=zh-cn#javascript_1
            ...otherConfigs,
        }
    };

    // return apiUrl.href;
    // return JSON.stringify(body);

    const res = await window.fetch(apiUrl.href, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (res.ok) {
        // 非流式输出
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

        // 流式输出
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let translatedText = "";
        let buffer = "";

        const processLines = (lines) => {
            for (const line of lines) {
                if (!line) continue;

                const trimmedLine = line.trim();
                if (trimmedLine === "" || trimmedLine === "data: [DONE]") continue;

                let jsonStr = line;
                if (line.startsWith("data:")) {
                    jsonStr = line.substring(5).trim();
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
                        const textPart = candidate.content.parts[0].text;
                        if (textPart) {
                            translatedText += textPart;
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
                const lines = buffer.split("\n");
                processLines(lines);
            }

            return translatedText;
        } catch (error) {
            throw new Error(`Streaming response processing error: ${error.message}`);
        }
    } else {
        throw new Error(`Http Request Error\nHttp Status: ${res.status}\n${await res.text()}`);
    }
}
