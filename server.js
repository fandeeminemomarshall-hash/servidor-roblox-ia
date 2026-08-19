const express = require('express');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// SYSTEM INSTRUCTION mejorada:
// - Aclara explícitamente que es LUAU (no Lua genérico, no Python).
// - Incluye un ejemplo concreto de sintaxis correcta (few-shot) para anclar
//   el estilo del modelo.
// - Mantiene tus reglas de seguridad originales.
// ---------------------------------------------------------------------------
const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio. El lenguaje es LUAU (una variante
tipada de Lua 5.1 usada por Roblox), NO Python y NO Lua genérico.

REGLAS DE SINTAXIS OBLIGATORIAS:
1. Todo bloque (function, if, for, while, do) DEBE cerrarse con la palabra "end".
   Un bloque "repeat ... until <condición>" NO lleva "end".
2. Los comentarios se escriben con "--", nunca con "#" ni "//".
3. NUNCA uses ":" para abrir un bloque (eso es Python). Usa "then" para if,
   "do" para for/while, y cierra siempre con "end".
4. No uses indentación como sustituto de "end". Roblox no es sensible a la
   indentación; todo bloque necesita su palabra de cierre explícita.
5. Antes de terminar tu respuesta, revisa mentalmente que cada
   function/if/for/while tenga su "end" correspondiente.

EJEMPLO DE SINTAXIS CORRECTA (síguelo como referencia de estilo):
local part = Instance.new("Part")
part.Name = "Ejemplo"
part.Parent = workspace

local function saludar(jugador)
	if jugador then
		print("Hola " .. jugador.Name)
	end
end

for i = 1, 5 do
	print(i)
end

Cuando el usuario te pida crear o generar algo, responde ÚNICAMENTE con código
Luau ejecutable en Roblox Studio. NO agregues explicaciones, NO uses bloques
de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.
El código debe crear los elementos en el Workspace usando Instance.new o
manipular propiedades.

REGLAS ESTRICTAS DE SEGURIDAD:
1. Queda totalmente PROHIBIDO usar :ClearAllChildren(), :Destroy() o cualquier
   método que borre objetos existentes del Workspace.
2. NUNCA limpies ni vacíes el Workspace completo.
3. Si el usuario pide remover o quitar algo, únicamente elimina ese objeto
   específico por su nombre exacto, jamás el escenario completo.
`;

// ---------------------------------------------------------------------------
// Chequeo heurístico de balance de bloques.
// No es un parser real de Luau (eso requeriría una librería dedicada), pero
// detecta el caso más común: código truncado o con "end" faltantes/sobrantes.
// ---------------------------------------------------------------------------
function checkBlockBalance(code) {
	// Cuenta aperturas de bloque que requieren "end".
	// Nota: "for ... do" y "while ... do" cuentan como UNA apertura cada uno
	// (el "do" es parte del encabezado, no un bloque aparte), así que solo
	// contamos las palabras clave que inician el bloque.
	const openers = (code.match(/\b(function|if|for|while)\b/g) || []).length;
	const enders = (code.match(/\bend\b/g) || []).length;

	// repeat...until no usa "end", así que no lo contamos como opener.
	// Un desbalance grande (diferencia > 0) casi siempre significa
	// truncamiento o un bloque mal cerrado.
	const diff = openers - enders;

	return {
		balanced: diff <= 0, // permitimos que sobren "end" sueltos sin bloquear
		diff,
		openers,
		enders,
	};
}

function cleanMarkdown(text) {
	return text
		.replace(/```lua/gi, '')
		.replace(/```luau/gi, '')
		.replace(/```/g, '')
		.trim();
}

async function callGemini(prompt, apiKey) {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

	const payload = {
		system_instruction: {
			parts: [{ text: SYSTEM_INSTRUCTION }],
		},
		contents: [
			{
				parts: [{ text: prompt }],
			},
		],
		generationConfig: {
			temperature: 0.3,       // menos creatividad = menos errores de sintaxis
			maxOutputTokens: 2048,  // sube este número si generas scripts largos
		},
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});

	const data = await response.json();

	if (!response.ok) {
		const err = new Error(data.error?.message || 'Error devuelto por la API de Gemini');
		err.status = response.status;
		throw err;
	}

	// Nota: la ruta correcta de Gemini es content.parts[0].text (parts es un
	// array), no content[0].text.
	const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
	return cleanMarkdown(rawText);
}

app.post('/generate', async (req, res) => {
	try {
		const { prompt } = req.body;

		if (!prompt) {
			return res.status(400).json({ error: 'El prompt es requerido.' });
		}

		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) {
			return res.status(500).json({ error: 'No se ha configurado GEMINI_API_KEY en el servidor.' });
		}

		let code = await callGemini(prompt, apiKey);
		let balance = checkBlockBalance(code);

		// Si detectamos desbalance (probable truncamiento o error de sintaxis),
		// reintentamos UNA vez pidiéndole explícitamente a Gemini que corrija
		// el problema, mostrándole su propio código.
		if (!balance.balanced) {
			const retryPrompt = `Tu respuesta anterior tiene un error de sintaxis: le faltan ${balance.diff} palabra(s) "end" respecto a los bloques abiertos (function/if/for/while). Aquí está tu código, corrígelo y devuelve SOLO el código Luau corregido, completo y balanceado, sin explicaciones:\n\n${code}`;

			code = await callGemini(retryPrompt, apiKey);
			balance = checkBlockBalance(code);
		}

		// Si sigue desbalanceado después del reintento, avisamos al plugin
		// en vez de mandar código roto directo a loadstring().
		if (!balance.balanced) {
			return res.status(422).json({
				error: 'La IA generó código con posible error de sintaxis (bloques sin cerrar) incluso tras un reintento. Revisa el prompt o inténtalo de nuevo.',
				code, // lo mandamos igual para que puedas inspeccionarlo si quieres
			});
		}

		return res.json({ code });
	} catch (error) {
		console.error('Error en /generate:', error);
		return res.status(error.status || 500).json({ error: error.message || 'Error interno del servidor.' });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Servidor escuchando en el puerto ${PORT}`);
});
