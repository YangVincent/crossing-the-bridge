// Proofreading examples for few-shot learning
// Add more examples here to improve error detection accuracy

const PROOFREADING_EXAMPLES = [
  {
    category: "字词错误",
    examples: [
      {
        text: "河北省赵县的洨河上，有一座世界闻名的石拱桥。",
        errors: [],
        explanation: "没有错误，世界闻名是完全正确的表达"
      },
      {
        text: "河北省赵县的洨河上，有一座世界著名的石拱桥。",
        errors: [],
        explanation: "没有错误，世界著名也是正确的表达"
      },
      {
        text: "河北省赵县的洨河上，有一座世界文明的石拱桥。",
        errors: [{"text": "文明", "type": "字词错误", "suggestion": "闻名"}],
        explanation: '此处应为"世界闻名"，"文明"是错误用词'
      },
      {
        text: "河北省赵县的洨河上,有一座世界文明的石拱桥。",
        errors: [{"text": "文明", "type": "字词错误", "suggestion": "闻名"}, {"text": ",", "type": "标点误用", "suggestion": "，"}],
        explanation: '同时存在字词错误和标点错误'
      },
      {
        text: "这个问题很复杂，需要仔细思考。",
        errors: [],
        explanation: "没有错误"
      },
      {
        text: "他是一个很有名誉的科学家。",
        errors: [{"text": "名誉", "type": "字词错误", "suggestion": "名望"}],
        explanation: '"名誉"通常指声誉，应用"名望"表示著名程度'
      },
      {
        text: "这本书的内容很丰富。",
        errors: [],
        explanation: "没有错误"
      },
      {
        text: "他对这个问题的看法很独道。",
        errors: [{"text": "独道", "type": "字词错误", "suggestion": "独到"}],
        explanation: '应该是"独到"（独特而深刻），不是"独道"'
      },
      {
        text: "这座桥历史悠久，闻名世界。",
        errors: [],
        explanation: "没有错误，闻名使用正确"
      },
      {
        text: "他的成就令人赞叹不己。",
        errors: [{"text": "不己", "type": "字词错误", "suggestion": "不已"}],
        explanation: '应该是"不已"（不止），不是"不己"'
      },
      {
        text: "这个问题涉及到很多方面。",
        errors: [],
        explanation: "没有错误，涉及使用正确"
      },
      {
        text: "这个桥梁的涉及很独特。",
        errors: [{"text": "涉及", "type": "字词错误", "suggestion": "设计"}],
        explanation: '"涉及"指关联到、牵涉到。"设计"指根据要求预先制定图样、方案。此处应为设计'
      },
      {
        text: "到现在已经有一千多年了。",
        errors: [],
        explanation: "没有错误，到现在使用正确"
      },
      {
        text: "至今已经有一千多年了。",
        errors: [],
        explanation: "没有错误，至今使用正确"
      }
    ]
  },
  {
    category: "标点误用",
    examples: [
      {
        text: "这是一个很好的想法,我们应该试试。",
        errors: [{"text": ",", "type": "标点误用", "suggestion": "，"}],
        explanation: '应使用中文逗号而非英文逗号'
      },
      {
        text: "今天天气真好！我们去公园吧。",
        errors: [],
        explanation: "标点使用正确"
      },
      {
        text: "这本书很有意思.",
        errors: [{"text": ".", "type": "标点误用", "suggestion": "。"}],
        explanation: '应使用中文句号而非英文句号'
      },
      {
        text: "你好,我叫小明.你叫什么名字?",
        errors: [{"text": ",", "type": "标点误用", "suggestion": "，"}, {"text": ".", "type": "标点误用", "suggestion": "。"}, {"text": "?", "type": "标点误用", "suggestion": "？"}],
        explanation: '应使用中文标点符号'
      },
      {
        text: "他说:\"你好\".",
        errors: [{"text": ":", "type": "标点误用", "suggestion": "："}, {"text": ".", "type": "标点误用", "suggestion": "。"}],
        explanation: '应使用中文标点'
      },
      {
        text: "这本书很有意思,值得一读.",
        errors: [{"text": ",", "type": "标点误用", "suggestion": "，"}, {"text": ".", "type": "标点误用", "suggestion": "。"}],
        explanation: '应使用中文逗号和句号'
      },
      {
        text: "你去吗?",
        errors: [{"text": "?", "type": "标点误用", "suggestion": "？"}],
        explanation: '应使用中文问号'
      },
      {
        text: "太棒了!",
        errors: [{"text": "!", "type": "标点误用", "suggestion": "！"}],
        explanation: '应使用中文感叹号'
      }
    ]
  },
  {
    category: "语序问题",
    examples: [
      {
        text: "我昨天去了公园在下午。",
        errors: [{"text": "去了公园在下午", "type": "语序问题", "suggestion": "在下午去了公园"}],
        explanation: "时间状语应放在动词前"
      },
      {
        text: "昨天下午我去了公园。",
        errors: [],
        explanation: "语序正确"
      },
      {
        text: "他很认真地完成了作业。",
        errors: [],
        explanation: "语序正确，状语位置恰当"
      },
      {
        text: "我在图书馆看书昨天。",
        errors: [{"text": "看书昨天", "type": "语序问题", "suggestion": "昨天看书"}],
        explanation: "时间词应该放在动词前"
      },
      {
        text: "这个问题我已经解决了。",
        errors: [],
        explanation: "语序正确"
      }
    ]
  },
  {
    category: "语法问题",
    examples: [
      {
        text: "因为下雨，所以我没去。",
        errors: [],
        explanation: "语法正确，因为...所以...是正确的关联词用法"
      },
      {
        text: "他们很喜欢这个电影。",
        errors: [],
        explanation: "语法正确"
      },
      {
        text: "这本书很值得一看。",
        errors: [],
        explanation: "语法正确"
      },
      {
        text: "他把作业写完成了。",
        errors: [{"text": "写完成", "type": "语法问题", "suggestion": "写完"}],
        explanation: "动词重复，应该用'写完'或'完成'，不能用'写完成'"
      },
      {
        text: "这个问题太难了，我不会做。",
        errors: [],
        explanation: "语法正确"
      },
      {
        text: "他学习成绩很优秀。",
        errors: [],
        explanation: "语法正确"
      },
      {
        text: "我对这个问题很感兴趣。",
        errors: [],
        explanation: "语法正确，'对...感兴趣'是正确搭配"
      },
      {
        text: "他的病已经康复了。",
        errors: [{"text": "病已经康复", "type": "语法问题", "suggestion": "病已经好了"}],
        explanation: "搭配不当，应该说'病好了'或'已经康复'，不说'病康复'"
      },
      {
        text: "这个活动很有意义。",
        errors: [],
        explanation: "语法正确"
      },
      {
        text: "他学习进步很大。",
        errors: [],
        explanation: "语法正确"
      }
    ]
  }
];

// Format examples into a prompt string
function formatExamplesForPrompt() {
  let prompt = "## 示例（学习这些模式）：\n\n";
  let exampleNum = 1;
  
  // Take the first 2 examples from each category
  for (const category of PROOFREADING_EXAMPLES) {
    const examples = category.examples.slice(0, 2);
    for (const example of examples) {
      prompt += `示例${exampleNum}：\n`;
      prompt += `输入："${example.text}"\n`;
      prompt += `输出：${JSON.stringify(example.errors)}\n`;
      if (example.explanation) {
        prompt += `解释：${example.explanation}\n`;
      }
      prompt += `\n`;
      exampleNum++;
    }
  }
  
  return prompt;
}

// Get all examples for a specific category
function getExamplesByCategory(category) {
  const categoryData = PROOFREADING_EXAMPLES.find(c => c.category === category);
  return categoryData ? categoryData.examples : [];
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROOFREADING_EXAMPLES,
    formatExamplesForPrompt,
    getExamplesByCategory
  };
}
