const express = require("express");

const app = express();

app.use(express.json({ limit: "1mb" }));

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = process.env.PORT || 3000;

// ============================================================
// INSTRUCCIÓN DEL SISTEMA
// ============================================================

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.

El lenguaje obligatorio es LUAU, la variante de Lua utilizada por Roblox.
NO uses Python.
NO uses JavaScript.
NO uses Lua genérico incompatible con Roblox.

Cuando el usuario te pida crear o generar algo:

- Responde ÚNICAMENTE con código Luau.
- NO escribas explicaciones.
- NO escribas texto antes ni después del código.
- NO utilices bloques Markdown.
- NO escribas \`\`\`lua.
- El resultado debe poder ejecutarse mediante loadstring() en Roblox Studio.

REGLAS DE SINTAXIS:

1. Todo function, if, for, while y do debe cerrarse correctamente con "end".
2. repeat ... until NO utiliza "end".
3. Los comentarios utilizan "--".
4. Los if utilizan "then".
5. Los for y while utilizan "do".
6. Nunca utilices sintaxis de Python.
7. Revisa que todos los bloques estén correctamente cerrados.

EJEMPLO:

local part = Instance.new("Part")
part.Name = "Ejemplo"
part.Size = Vector3.new(5, 5, 5)
part.Position = Vector3.new(0, 5, 0)
part.Parent = workspace

local function crearParte(nombre, posicion)
	local nuevaParte = Instance.new("Part")
	nuevaParte.Name = nombre
	nuevaParte.Position = posicion
	nuevaParte.Parent = workspace
end

crearParte("Parte1", Vector3.new(0, 5, 0))

REGLAS ESTRICTAS DE SEGURIDAD:

1. PROHIBIDO utilizar :ClearAllChildren().
2. PROHIBIDO utilizar :Destroy().
3. PROHIBIDO eliminar objetos existentes de forma masiva.
4. PROHIBIDO limpiar Workspace.
5. PROHIBIDO vaciar Workspace.
6. No elimines objetos existentes salvo que el usuario solicite explícitamente
   eliminar un objeto concreto.
7. Si el usuario solicita eliminar algo, solo puede eliminarse el objeto
   específico solicitado y debe identificarse por su nombre exacto.
8. Nunca elimines Workspace completo.
9. Nunca elimines todos los hijos de Workspace.
10. No generes código destinado a destruir o borrar el proyecto del usuario.

Prioriza siempre crear nuevos objetos mediante Instance.new().
`;

// ============================================================
// RUTA DE PRUEBA
// ============================================================

app.get("/", (req, res) => {
	res.status(200).json({
		status: "online",
		service: "Roblox AI Assistant",
		message: "Servidor funcionando correctamente.",
	});
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (req, res) => {
	res.status(200).json({
		status: "ok",
	});
});

// ============================================================
// LIMPIAR MARKDOWN
// ============================================================

function cleanMarkdown(text) {
	if (!text) {
		return "";
	}

	return text
		.replace(/```luau/gi, "")
		.replace(/```lua/gi, "")
		.replace(/```/g, "")
		.trim();
}

// ============================================================
// VALIDACIÓN BÁSICA
// ============================================================

function validateGeneratedCode(code) {
	const dangerousPatterns = [
		/:ClearAllChildren\s*\(/i,
		/:Destroy\s*\(/i,
		/\bClearAllChildren\s*\(/i,
		/\bDestroy\s*\(/i,
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(code)) {
			return {
				valid: false,
				reason: "El código generado contiene una operación bloqueada.",
			};
		}
	}

	return {
		valid: true,
		reason: null,
	};
}

// ============================================================
// BALANCE DE BLOQUES
// ============================================================

function checkBlockBalance(code) {
	const withoutStrings = code
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, "''");

	const openers =
		withoutStrings.match(/\b(function|if|for|while)\b/g) || [];

	const enders =
		withoutStrings.match(/\bend\b/g) || [];

	const diff = openers.length - enders.length;

	return {
		balanced: diff === 0,
		diff,
		openers: openers.length,
		enders: enders.length,
	};
}

// ============================================================
// GEMINI
// ============================================================

async function callGemini(prompt, apiKey) {
	const url =
		`https://generativelanguage.googleapis.com/v1beta/models/` +
		`gemini-2.5-flash:generateContent?key=${apiKey}`;

	const payload = {
		system_instruction: {
			parts: [
				{
					text: SYSTEM_INSTRUCTION,
				},
			],
		},

		contents: [
			{
				role: "user",
				parts: [
					{
						text: prompt,
					},
				],
			},
		],

		generationConfig: {
			temperature: 0.2,
			maxOutputTokens: 4096,
		},
	};

	const response = await fetch(url, {
		method: "POST",

		headers: {
			"Content-Type": "application/json",
		},

		body: JSON.stringify(payload),
	});

	const data = await response.json();

	if (!response.ok) {
		const error = new Error(
			data?.error?.message ||
			"Google Gemini devolvió un error."
		);

		error.status = response.status;

		throw error;
	}

	const text =
		data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

	if (!text) {
		throw new Error(
			"Gemini no devolvió código."
		);
	}

	return cleanMarkdown(text);
}

// ============================================================
// POST /generate
// ============================================================

app.post("/generate", async (req, res) => {
	try {
		const prompt = req.body?.prompt;

		if (
			typeof prompt !== "string" ||
			prompt.trim().length === 0
		) {
			return res.status(400).json({
				error: "El prompt es requerido.",
			});
		}

		if (prompt.length > 10000) {
			return res.status(400).json({
				error: "El prompt es demasiado largo.",
			});
		}

		const apiKey = process.env.GEMINI_API_KEY;

		if (!apiKey) {
			return res.status(500).json({
				error:
					"No se ha configurado GEMINI_API_KEY en Render.",
			});
		}

		console.log("Generando código para:", prompt);

		let code = await callGemini(
			prompt.trim(),
			apiKey
		);

		// ========================================================
		// VALIDACIÓN DE SEGURIDAD
		// ========================================================

		let security = validateGeneratedCode(code);

		if (!security.valid) {
			console.warn(
				"Código bloqueado:",
				security.reason
			);

			return res.status(422).json({
				error: security.reason,
			});
		}

		// ========================================================
		// BALANCE
		// ========================================================

		let balance = checkBlockBalance(code);

		// ========================================================
		// REINTENTO
		// ========================================================

		if (!balance.balanced) {
			console.log(
				"Posible error de bloques. Intentando corregir..."
			);

			const retryPrompt = `
Tu respuesta anterior tiene un posible error de sintaxis.

Debes devolver SOLO código Luau.

No agregues explicaciones.
No uses Markdown.
No uses bloques de código.

Corrige todos los bloques function, if, for y while.

Aquí está el código anterior:

${code}

Devuelve el código Luau completo y corregido.
`;

			code = await callGemini(
				retryPrompt,
				apiKey
			);

			security = validateGeneratedCode(code);

			if (!security.valid) {
				return res.status(422).json({
					error: security.reason,
				});
			}

			balance = checkBlockBalance(code);
		}

		// ========================================================
		// RESPUESTA FINAL
		// ========================================================

		if (!balance.balanced) {
			return res.status(422).json({
				error:
					"Gemini generó código con posible error de sintaxis.",
				code: code,
			});
		}

		console.log(
			"Código generado correctamente."
		);

		return res.status(200).json({
			code: code,
		});

	} catch (error) {
		console.error(
			"Error en /generate:",
			error
		);

		return res.status(
			error.status || 500
		).json({
			error:
				error.message ||
				"Error interno del servidor.",
		});
	}
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
	res.status(404).json({
		error: "Ruta no encontrada.",
		path: req.path,
		method: req.method,
	});
});

// ============================================================
// ERROR GENERAL
// ============================================================

app.use((error, req, res, next) => {
	console.error(
		"Error general:",
		error
	);

	res.status(500).json({
		error: "Error interno del servidor.",
	});
});

// ============================================================
// SERVIDOR
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
	console.log(
		`Servidor escuchando en el puerto ${PORT}`
	);
});
