import { Request, Response } from "express";
import Thumbnail from "../models/Thumbnail.js";
import { v2 as cloudinary } from "cloudinary";

const stylePrompts = {
  "Bold & Graphic":
    "eye-catching thumbnail, bold typography, vibrant colors, expressive facial reaction, dramatic lighting, high contrast, click-worthy composition, professional style",
  "Tech/Futuristic":
    "futuristic thumbnail, sleek modern design, digital UI elements, glowing accents, holographic effects, cyber-tech aesthetic, sharp lighting, high-tech atmosphere",
  Minimalist:
    "minimalist thumbnail, clean layout, simple shapes, limited color palette, plenty of negative space, modern flat design, clear focal point",
  Photorealistic:
    "photorealistic thumbnail, ultra-realistic lighting, natural skin tones, candid moment, DSLR-style photography, lifestyle realism, shallow depth of field",
  Illustrated:
    "illustrated thumbnail, custom digital illustration, stylized characters, bold outlines, vibrant colors, creative cartoon or vector art style",
};

const colorSchemeDescriptions = {
  vibrant:
    "vibrant and energetic colors, high saturation, bold contrasts, eye-catching palette",
  sunset:
    "warm sunset tones, orange pink and purple hues, soft gradients, cinematic glow",
  forest:
    "natural green tones, earthy colors, calm and organic palette, fresh atmosphere",
  neon: "neon glow effects, electric blues and pinks, cyberpunk lighting, high contrast glow",
  purple:
    "purple-dominant color palette, magenta and violet tones, modern and stylish mood",
  monochrome:
    "black and white color scheme, high contrast, dramatic lighting, timeless aesthetic",
  ocean:
    "cool blue and teal tones, aquatic color palette, fresh and clean atmosphere",
  pastel:
    "soft pastel colors, low saturation, gentle tones, calm and friendly aesthetic",
};

// Hugging Face free image generation function
const generateImageWithHuggingFace = async (prompt: string): Promise<Buffer> => {
  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    throw new Error("HF_TOKEN is not set in environment variables");
  }

  // Using FLUX.1-dev — best free image generation model on Hugging Face
  const response = await fetch(
    "https://router.huggingface.co/fal-ai/models/black-forest-labs/FLUX.1-dev",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          num_inference_steps: 28,
          guidance_scale: 3.5,
        },
      }),
    }
  );

  // If model is loading, Hugging Face returns 503 — we retry after a delay
  if (response.status === 503) {
    const errorData = await response.json() as any;
    const waitTime = errorData?.estimated_time
      ? Math.ceil(errorData.estimated_time) * 1000
      : 20000; // default 20 seconds wait

    console.log(`Model is loading, waiting ${waitTime / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Retry once after waiting
    const retryResponse = await fetch(
      "https://router.huggingface.co/fal-ai/models/black-forest-labs/FLUX.1-dev",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            num_inference_steps: 28,
            guidance_scale: 3.5,
          },
        }),
      }
    );

    if (!retryResponse.ok) {
      const errText = await retryResponse.text();
      throw new Error(`Hugging Face API error after retry: ${errText}`);
    }

    const arrayBuffer = await retryResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Hugging Face API error: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const generateThumbnail = async (req: Request, res: Response) => {
  try {
    const { userId } = req.session;
    const {
      title,
      prompt: user_prompt,
      style,
      aspect_ratio,
      color_scheme,
      text_overlay,
    } = req.body;

    const thumbnail = await Thumbnail.create({
      userId,
      title,
      prompt_used: user_prompt,
      user_prompt,
      style,
      aspect_ratio,
      color_scheme,
      text_overlay,
      isGenerating: true,
    });

    // Build the prompt
    let prompt = `Create a ${stylePrompts[style as keyof typeof stylePrompts]} for: "${title}". `;

    if (color_scheme) {
      prompt += `Use a ${colorSchemeDescriptions[color_scheme as keyof typeof colorSchemeDescriptions]} color scheme. `;
    }

    if (user_prompt) {
      prompt += `Additional details: ${user_prompt}. `;
    }

    prompt += `The thumbnail should be visually stunning and designed to maximize click-through rate. Make it bold, professional, and impossible to ignore.`;

    // Generate the image using Hugging Face (FREE)
    const imageBuffer = await generateImageWithHuggingFace(prompt);

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(
      `data:image/png;base64,${imageBuffer.toString("base64")}`
    );

    thumbnail.image_url = uploadResult.secure_url;
    thumbnail.isGenerating = false;
    await thumbnail.save();

    res.json({ message: "Thumbnail Generated", thumbnail });
  } catch (error: any) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};

// Controller For Thumbnail Deletion
export const deleteThumbnail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.session;

    await Thumbnail.findByIdAndDelete({ _id: id, userId });

    res.json({ message: "Thumbnail deleted successfully" });
  } catch (error: any) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};