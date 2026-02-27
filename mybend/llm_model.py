from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI


class LLMClient:
    def __init__(self, provider: str, api_key: str, model: str):
        self.provider = "groq"
        self.api_key = "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"
        self.model = 'openai/gpt-oss-120b'

        
    def get_llm_model(self):
        # Initialize provider clients once
        if self.provider == "openai":
            self.client = ChatOpenAI(model=self.model, api_key=self.api_key)
        elif self.provider == "groq":
            self.client = ChatGroq(model=self.model, 
                                   api_key=self.api_key,
                                   temperature=0.3, 
                                   verbose=False, 
                                   reasoning_format="parsed",
                                #   max_tokens = 300
                                   )
        elif self.provider == "anthropic":
            self.client = ChatAnthropic(model=self.model, api_key=self.api_key)
        elif self.provider == "gemini":
            self.client = ChatGoogleGenerativeAI(model=self.model, 
                                                 google_api_key=self.api_key,
                                                #  temperature=0.7, 
                                                #  verbose=False, 
                                                #  reasoning_format="parsed"
                                                # #  ,
                                                # #  max_tokens = 300
                                                 )
        else:
            raise ValueError("Unsupported provider")
        return self.client
    