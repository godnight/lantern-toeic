/**
 * LANTERN resource catalogue. Metadata and study steps are newly written.
 * No third-party questions, transcripts, images, PDFs or audio are included.
 * `redistributable` describes a qualified source policy, NOT an import approval.
 * Keep every current entry as an external page link; see CONTENT_RESOURCE_EVIDENCE.md.
 */
export type LearningResource = {
  id: string;
  title: string;
  provider: string;
  url: string;
  description: string;
  category: "official" | "listening" | "reading" | "speaking";
  /** TOEIC L&R parts only; an empty list can indicate Speaking practice. */
  parts: number[];
  /** Suggested session length; not the media duration. */
  minutes: number;
  steps: string[];
  hasAudio: boolean;
  /** A listening transcript, not merely a reading passage or test directions. */
  hasTranscript: boolean;
  accessNote: string;
  reuse: "link_only" | "redistributable";
  licenseNote: string;
  licenseUrl: string;
  verifiedAt: string;
  sourceType: "official_exam" | "general_english";
  /** Human review of this catalogue's mapping/instructions, not the publisher's process. */
  humanReviewed: boolean;
  verificationStatus: "primary_source_checked_by_ai";
  mediaPlaybackVerified: boolean;
  integration: "external_link";
  rehostApproved: boolean;
  assetAudit: "not_applicable_for_link" | "required_before_import";
};

const checked = {
  verifiedAt: "2026-09-07",
  humanReviewed: false,
  verificationStatus: "primary_source_checked_by_ai" as const,
  mediaPlaybackVerified: false,
  integration: "external_link" as const,
  rehostApproved: false,
};

const official = {
  ...checked,
  provider: "IIBC / ETS",
  category: "official" as const,
  sourceType: "official_exam" as const,
  hasTranscript: false,
  reuse: "link_only" as const,
  licenseUrl: "https://www.iibc-global.org/english/toeic/test/lr/about/format.html",
  licenseNote: "ETS保留官方样题与音频版权；本站仅提供原站链接，不复制或缓存题目、图片、音频和PDF。",
  accessNote: "官方免费样题，无需登录；页面导航为日文，题目为英文。",
  assetAudit: "not_applicable_for_link" as const,
};

const voa = {
  ...checked,
  provider: "VOA Learning English",
  category: "listening" as const,
  sourceType: "general_english" as const,
  hasAudio: true,
  hasTranscript: true,
  reuse: "redistributable" as const,
  licenseUrl: "https://learningenglish.voanews.com/p/6021.html",
  licenseNote: "VOA独立制作的文字、音频和视频有公共领域再利用声明，要求注明来源；第三方素材除外。逐项确认权利前，本条仍只外链，不导入媒体或整页。",
  accessNote: "免费课程页含对话音频、文字、视频和小测验；无需登录。属于通用英语补充材料，不是TOEIC模拟题。",
  assetAudit: "required_before_import" as const,
};

const britishCouncil = {
  ...checked,
  provider: "British Council LearnEnglish",
  sourceType: "general_english" as const,
  reuse: "link_only" as const,
  licenseUrl: "https://www.britishcouncil.org/terms",
  licenseNote: "条款允许连接免费课程的文字链接；另站重新发布、改编及脱离课程页面的音频直链需要事先书面许可。",
  accessNote: "课程内容免费，无需登录即可学习；收藏或评论可能需要账号。属于通用英语补充材料。",
  assetAudit: "not_applicable_for_link" as const,
};

export const resources: LearningResource[] = [
  {
    ...official,
    id: "iibc-p1",
    title: "Part 1 · 官方图片题",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample01.html",
    description: "用官方图片与录音熟悉人物动作、物品位置和状态描述。",
    parts: [1], minutes: 5, hasAudio: true,
    steps: ["1分钟：只看照片，预测人物动作与物品位置。", "2分钟：播放两道样题，各选一次答案。", "2分钟：在原站核对并复听，记下一处听错的声音。"],
  },
  {
    ...official,
    id: "iibc-p2",
    title: "Part 2 · 官方问答题",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample02.html",
    description: "四道官方问答样题，练习抓住疑问词、请求和自然回应。",
    parts: [2], minutes: 7, hasAudio: true,
    steps: ["2分钟：盲听四道样题，不暂停猜句意。", "3分钟：核对答案，再听自己犹豫的两题。", "2分钟：用自己的话说出每题是在询问信息、确认还是请求。"],
  },
  {
    ...official,
    id: "iibc-p3",
    title: "Part 3 · 官方多人对话",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample03.html",
    description: "以真实考试题型练习对话主旨、细节与接下来要做的事。",
    parts: [3], minutes: 10, hasAudio: true,
    steps: ["2分钟：选一组对话，先读该组的三个问题。", "3分钟：听一次并完成整组三题。", "3分钟：在原站核对，复听寻找答案依据。", "2分钟：口头概括谁在谈什么，以及下一步行动。"],
  },
  {
    ...official,
    id: "iibc-p4",
    title: "Part 4 · 官方独白与通知",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample04.html",
    description: "练习从一段通知或说明中抓取目的、时间与行动要求。",
    parts: [4], minutes: 10, hasAudio: true,
    steps: ["2分钟：选一组三题，圈定需要听的时间、地点或行动。", "3分钟：听一次并完成该组三题。", "3分钟：在原站核对，再听漏掉的细节。", "2分钟：用三个关键词重述主旨与行动要求。"],
  },
  {
    ...official,
    id: "iibc-p5",
    title: "Part 5 · 官方短句填空",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample05.html",
    description: "识别空格需要的词性，再结合时态、连接词和搭配选答案。",
    parts: [5], minutes: 7, hasAudio: false,
    steps: ["2分钟：限时完成页面前三题。", "3分钟：在原站核对，说明每个空格的语法作用。", "2分钟：针对最不确定的知识点，自写一个新句子。"],
  },
  {
    ...official,
    id: "iibc-p6",
    title: "Part 6 · 官方邮件填空",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample06.html",
    description: "一封邮件配四道题，练习语法和上下文衔接一起判断。",
    parts: [6], minutes: 10, hasAudio: false,
    steps: ["2分钟：先读整封邮件，确定写信目的。", "4分钟：完成四个空格，留意前后句之间的关系。", "4分钟：在原站核对，用自己的话解释最难的一题。"],
  },
  {
    ...official,
    id: "iibc-p7-single",
    title: "Part 7 · 官方单篇阅读",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample07_01.html",
    description: "从短广告和文章开始，练习定位细节与识别改写表达。",
    parts: [7], minutes: 10, hasAudio: false,
    steps: ["2分钟：选一篇，先读问题并标记要找的信息。", "4分钟：读材料并作答。", "4分钟：在原站核对，找出答案选项与原文的改写关系。"],
  },
  {
    ...official,
    id: "iibc-p7-multiple",
    title: "Part 7 · 官方三篇关联阅读",
    url: "https://www.iibc-global.org/toeic/test/lr/about/format/sample07_04.html",
    description: "广告、购物车与邮件配五道题，训练跨材料核对信息。",
    parts: [7], minutes: 15, hasAudio: false,
    steps: ["3分钟：浏览三份材料，判断每份材料提供什么信息。", "7分钟：完成五题，遇到关联题时核对两份材料。", "5分钟：在原站核对，记下一次跨材料定位的方法。"],
  },
  {
    ...official,
    id: "iibc-speaking",
    title: "Speaking · 官方口语样题",
    category: "speaking",
    url: "https://www.iibc-global.org/toeic/test/speaking/about/format/sampletest.html",
    description: "官方口语练习入口；配合语音题目、参考回答和说明熟悉五类任务。",
    parts: [], minutes: 10, hasAudio: true,
    accessNote: "免费日文界面，英语口语任务。官方说明页介绍语音、参考回答及解说；样题播放器需浏览器正常运行。",
    licenseUrl: "https://www.iibc-global.org/toeic/test/speaking/about/format/sampletest.html",
    steps: ["2分钟：选择一类任务并阅读原站要求。", "3分钟：按原站时限作答一次，可用手机录音工具记录自己的回答。", "3分钟：听参考回答，比较是否回应了任务重点。", "2分钟：只改进一个问题，再说一次。"],
  },
  {
    ...official,
    id: "ets-preparation",
    provider: "ETS",
    title: "ETS · 官方样题与考生手册",
    url: "https://www.ets.org/toeic/test-takers/prepare.html",
    description: "官方听读、口语写作样题PDF及手册入口，适合核对题型和答题要求。",
    parts: [1, 2, 3, 4, 5, 6, 7], minutes: 10, hasAudio: false,
    accessNote: "样题PDF与考生手册可免费获取；同页部分课程或产品另有费用。此卡只指向免费资料。",
    licenseUrl: "https://www.ets.org/legal/permissions/how-to-request.html",
    steps: ["2分钟：在原站选择听读或口语写作的Sample Tests PDF。", "5分钟：只练一类任务，先独立作答。", "3分钟：核对原站说明，记录一个下次练习目标。"],
  },
  {
    ...voa,
    id: "voa-budget-cuts",
    title: "办公室听力 · Budget Cuts",
    url: "https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html",
    description: "从办公室预算话题练习抓主旨，使用原站对话文字进行精听。",
    parts: [3, 4], minutes: 12,
    steps: ["4分钟：先听Conversation音频，不展开或向下看对话文字。", "4分钟：对照原站文字再听，找出两个漏听的表达。", "4分钟：完成原站小测验，再用自己的话复述办公室发生了什么。"],
  },
  {
    ...voa,
    id: "voa-interview",
    title: "对话与口语 · The Interview",
    url: "https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson-2/3960471.html",
    description: "面试情境的对话、逐字文字和小测验，练习理解问题与完整回应。",
    parts: [2, 3], minutes: 12,
    steps: ["5分钟：盲听Conversation音频，记下谈话目的。", "4分钟：读原站对话并复听，选两句做跟读。", "3分钟：用自己的经历回答一个普通学习或团队合作问题，录下并回听。"],
  },
  {
    ...britishCouncil,
    id: "bc-new-team-member",
    title: "A1 听力 · 认识新同事",
    category: "listening",
    url: "https://learnenglish.britishcouncil.org/free-resources/listening/a1/meeting-new-team-member",
    description: "简短职场介绍对话，配音频、Transcript与练习，适合先建立听懂的体验。",
    parts: [2, 3], minutes: 8, hasAudio: true, hasTranscript: true,
    steps: ["2分钟：完成Preparation后，先听一次音频。", "3分钟：完成练习，再打开Transcript核对人名与职位。", "3分钟：跟读两句，再用自己的话做20秒自我介绍。"],
  },
  {
    ...checked,
    id: "elllo-life-without-cars",
    title: "B2 自然对话 · Life Without Cars",
    provider: "ELLLO",
    category: "listening",
    sourceType: "general_english",
    url: "https://elllo.org/english/1301/T1340-Jeremy-Car.htm",
    description: "两位说话者比较交通方式；配音频、Script、Quiz和Vocab，训练观点与转折。",
    parts: [3, 4], minutes: 10, hasAudio: true, hasTranscript: true,
    steps: ["3分钟：先听对话，分别概括两人的观点。", "4分钟：阅读Script核对，再做Quiz。", "3分钟：在Vocab选一个表达，自写一句与日常出行有关的句子。"],
    accessNote: "原站标注B2，免费无需登录；可先选择听一半。不是TOEIC样题。",
    reuse: "link_only",
    licenseUrl: "https://www.elllo.org/about/faq.htm",
    licenseNote: "FAQ允许教师将可下载音频用于课堂或班级LMS；未找到涵盖公开共享App的整库重发许可，因此本条只连接课程页。",
    assetAudit: "not_applicable_for_link",
  },
  {
    ...britishCouncil,
    id: "bc-passives",
    title: "B1–B2 阅读与语法 · 被动语态",
    category: "reading",
    url: "https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/passives",
    description: "用前后两次互动练习理解被动语态，可补充Part 5和Part 6语法基础。",
    parts: [5, 6], minutes: 10, hasAudio: false, hasTranscript: false,
    steps: ["3分钟：先做Grammar test 1，保留自己不确定的题。", "4分钟：读原站说明，观察be动词与过去分词。", "3分钟：做Grammar test 2，再自写一句工作或学习安排。"],
  },
];

export const learningResources = resources;
