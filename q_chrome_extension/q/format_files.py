import sys
import os
import json
import re
from openai import OpenAI
from dotenv import load_dotenv
from datetime import datetime, timezone

MAX_MODEL_TOKENS = 128000
SAFETY_BUFFER = 2000

def estimate_token_count(text):
    return int(len(text) / 4.0)

# 🟢 Logging helpers
def log(msg, icon='🟢'):
    print(f"{icon} {msg}")

# Load env vars from ../.env (relative to this script)
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(dotenv_path)
api_key = os.getenv("API_KEY")

if not api_key:
    log("Error: API_KEY not found in ../.env", '🔴')
    sys.exit(1)

client = OpenAI(api_key=api_key)

# Combined schema for business and creative (story, script, manga, design, etc)
SCHEMA = '''
{
  "project_identity": {
    "name": "TowerUp! – AirTrafficEmpire",
    "one_liner": "TowerUp! is a real-time air traffic control empire-builder where you manage chaos, upgrade airports, and dominate the skies one landing at a time.",
    "domain": {
      "suggested": "towerupgame.com",
      "custom_provider": null
    },
    "ownership": {
      "created_by": "[Q]",
      "rights": "User owned via Nexus codegen",
      "hosting": {
        "cloud_providers": ["aws", "gcp", "az"],
        "ownership_model": "bring-your-own-cloud"
      }
    }
  },
  "business_core": {
    "monetization": {
      "model": "freemium",
      "subscription": {
        "enabled": true,
        "tiers": ["free", "premium"],
        "pricepoints": {
          "monthly": null,
          "yearly": null
        }
      },
      "product": {
        "type": "app-as-product",
        "sku_required": false,
        "ecommerce": false,
        "viewable": false
      },
      "affiliate": {
        "has_coupon_code": true,
        "incentive": "invite tracking"
      }
    },
    "user_features": {
      "login": {
        "enabled": true,
        "profile_fields": ["username", "email", "avatar"]
      },
      "sharing": {
        "enabled": true,
        "channel": ["social"]
      }
    },
    "information_architecture": {
      "pages": [
        {
          "title": "Help",
          "type": "contact",
          "form": true,
          "chatbot": false
        },
        {
          "title": "Gameplay Breakdown",
          "type": "info",
          "sections": [
            "Screen Architecture",
            "Upgrades",
            "Monetization",
            "Target Audience"
          ]
        }
      ]
    }
  },
  "marketing_engine": {
    "plan": "[not yet answered]",
    "channels": [],
    "viral_mechanics": {
      "share_incentive": "coupon tracking",
      "referral_rewards": true
    }
  },
  "technical_spec": {
    "stack": {
      "frontend": "[auto-generated]",
      "backend": "[auto-generated]",
      "tools": [],
      "workflow": "generated via Nexus",
      "cloud": {
        "provider": "user choice",
        "deployment": "automated",
        "infrastructure": "HA scalable"
      }
    },
    "data": {
      "required": false,
      "sources": [],
      "api": {
        "available": false,
        "docs": []
      }
    }
  },
  "timeline": {
    "phases": [
      {
        "milestone": "Design + Code Generation",
        "due_date": "TBD",
        "tasks": [
          "UI design generation",
          "Data model schema creation",
          "API backend creation"
        ]
      },
      {
        "milestone": "Deployment",
        "due_date": "TBD",
        "tasks": [
          "Domain registration",
          "Nexus deploy to AWS/GCP/AZ"
        ]
      }
    ]
  },
  "metadata": {
    "source_questionnaire": "Nexus Platform Q&A",
    "version": "v1.0.0",
    "timestamp": "[auto]",
    "original_prompt_summary": "TowerUp! empire builder simulation generated from Q system"
  }
}

{
  "project": {
    "name": "",
    "elevator_pitch": "",
    "summary": "",
    "type": "",
    "logline": "",
    "domain": "",
    "ownership": {
      "creators": [],
      "team_roles": [],
      "contact": {
        "has_contact_page": false,
        "form": false,
        "chatbot": false
      }
    },
    "business_model": {
      "monetization": {
        "is_subscription": false,
        "subscription_tiers": [],
        "is_product": false,
        "product_description": "",
        "sku_tracking": false,
        "ecommerce_enabled": false,
        "viewable_products": false,
        "products": [],
        "search_enabled": false,
        "product_view": false
      },
      "affiliate": {
        "enabled": false,
        "incentive": "coupon"
      }
    },
    "target_audience": {
      "demographic": "",
      "psychographic": "",
      "market_size": "",
      "competition": ""
    },
    "marketing": {
      "strategy": "",
      "channels": [],
      "share_system": {
        "enabled": false,
        "incentive": "coupon"
      }
    },
    "data_requirements": {
      "required": false,
      "sources": [],
      "api": {
        "has_feed": false,
        "documentation_links": []
      }
    },
    "features": {
      "user_login": false,
      "user_profile_fields": [],
      "pages": [],
      "screens": [],
      "info_pages": [],
      "has_contact_page": false
    },
    "technical": {
      "tools": [],
      "software": [],
      "workflow": "",
      "frontend": "",
      "backend": "",
      "cloud": {
        "provider": "",
        "scaling": "",
        "region": ""
      }
    },
    "roadmap": [
      {
        "milestone": "",
        "due_date": "",
        "tasks": []
      }
    ],
    "risks": [],
    "open_issues": [],
    "meta": {
      "source": "",
      "timestamp": "",
      "notes": ""
    }
  }
}



'''

STRUCTURE_PROMPT = '''
You are a creative and business requirements analyst. An account manager, business development, marketing, design director, software engineer and engineering manager and of course potential CTO of this idea

Given any messy or unstructured business, app, piece of software, suite of applications, or full blown platform / service, or creative endevors like comic, manga, story, or other creative project document, extract all meaningful details and organize them into a **single structured JSON** using the schema below.

Guidelines:
- Populate as many fields as possible with data from the input. For businesses / software structure different screens or pages and what they look like and do. identify in meta data what type of applications are needed (ios, web, etc)
- For creative projects start with audience, genre, descrpition, process, related works, script or work
- Use your judgment to group and split the content into relevant fields, including creative/art/story/script aspects and business/model/tech.
- For characters, scenes, panels, and script: extract and nest if available (auto-detect creative structure).
- For business, tech, and roadmap: extract requirements, objectives, and details.
- Use arrays/lists for multiple values.
- If a field is missing, leave as "" or [].
- For meta.source_file, use the file name if available.
- For meta.original_text_excerpt, use the first 512 chars of input.
- For meta.timestamp, use the current UTC ISO timestamp.
- Never invent details not in the text, but do use your best categorization.

Schema:
<SCHEMA_START>
%s
<SCHEMA_END>

Project description:
\"\"\"%s\"\"\"

Output only a single valid UTF-8 JSON object matching the schema above, no comments or extra text. Do not wrap in an array.
'''

def normalize_filename(txt_path):
    basename = os.path.basename(txt_path)
    name, _ = os.path.splitext(basename)
    name = re.sub(r'[^a-zA-Z0-9]', '_', name).lower()
    name = re.sub(r'_+', '_', name)
    return f"nexus_{name}"
def run_openai(prompt):
    log("Estimating token usage...", '🟡')
    prompt_token_estimate = estimate_token_count(prompt)
    max_response_tokens = MAX_MODEL_TOKENS - prompt_token_estimate - SAFETY_BUFFER

    if max_response_tokens <= 0:
        log(f"🔴 Prompt too large: est {prompt_token_estimate} tokens, leaves {max_response_tokens}.", '🔴')
        sys.exit(1)

    log(f"🧠 Estimated prompt tokens: {prompt_token_estimate}, max response tokens: {max_response_tokens}", '🟢')

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a creative and business structuring expert."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=max_response_tokens,
        temperature=0.0
    )
    log("Received response from OpenAI.", '🟢')
    return response.choices[0].message.content.strip()


def main():
    if len(sys.argv) < 2:
        log("Usage: python format_files.py /path/to/file.txt", '🟡')
        sys.exit(1)
    txt_path = sys.argv[1]
    if not os.path.isfile(txt_path):
        log(f"Error: {txt_path} not found.", '🔴')
        sys.exit(1)

    log(f"[THREAD] 🟢 Start: {txt_path}")

    with open(txt_path, encoding='utf-8') as f:
        contents = f.read()

    norm_base = normalize_filename(txt_path)

    # 🔵 Create originals directory if not exists
    originals_dir = os.path.join(os.path.dirname(txt_path), "originals")
    os.makedirs(originals_dir, exist_ok=True)

    # 🟢 Write original content as JSON
    original_json_path = os.path.join(originals_dir, f"{norm_base}_original.json")
    with open(original_json_path, "w", encoding='utf-8') as f:
        json.dump({"content": contents}, f, ensure_ascii=False, indent=2)
    log(f"Wrote original JSON: {original_json_path}", '🟢')

    meta_file = os.path.basename(txt_path)
    meta_excerpt = contents[:512]
    meta_timestamp = datetime.now(timezone.utc).isoformat()
    prompt_filled = STRUCTURE_PROMPT % (SCHEMA, contents)

    try:
        json_output = run_openai(prompt_filled)
        log(f"🔵 RESPONSE FROM OPENAI (should be json): {json_output}")
        if not json_output.strip():
            raise ValueError("Received empty response from OpenAI.")

        parsed = json.loads(json_output)
        parsed.setdefault('meta', {})
        parsed['meta']['source_file'] = meta_file
        parsed['meta']['original_text_excerpt'] = meta_excerpt
        parsed['meta']['timestamp'] = meta_timestamp

        output_json_path = os.path.join(os.path.dirname(txt_path), f"{norm_base}.json")
        with open(output_json_path, "w", encoding='utf-8') as f:
            json.dump(parsed, f, ensure_ascii=False, indent=2)
        log(f"🟢 [THREAD COMPLETE] {output_json_path}")

    except Exception as e:
        log(f"🔴 Failed to parse/save AI output for {txt_path}: {e}")
        error_path = os.path.join(os.path.dirname(txt_path), f"{norm_base}_error.json")
        with open(error_path, "w", encoding='utf-8') as f:
            f.write(json_output if 'json_output' in locals() else str(e))

    log(f"[THREAD END] 🟢 {txt_path}\n")

if __name__ == "__main__":
    log("🟢 [PYTHON SCRIPT START]")
    main()
    log("🟢 [PYTHON SCRIPT ALL COMPLETE]")
