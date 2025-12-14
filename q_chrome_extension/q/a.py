import sys
import os
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from ../.env
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(dotenv_path)

# Get API key from environment variables
api_key = os.getenv("API_KEY")

if not api_key:
    print("Error: API_KEY not found in ../.env")
    sys.exit(1)

client = OpenAI(api_key=api_key)

def get_response(prompt):
    # Send a request to the OpenAI API
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=4000   # Adjust as needed
    )

    # Extract the response from the completion
    answer = response.choices[0].message.content

    # Print the answer
    print("Answer:", answer)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python script.py 'prompt text'")
        sys.exit(1)

    prompt_text = sys.argv[1]
    get_response(prompt_text)
