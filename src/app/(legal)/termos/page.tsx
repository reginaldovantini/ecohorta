import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "O que é a EcoHorta Inteligente, quem pode usar, como as missões funcionam e quais são as regras.",
};

const ATUALIZADA_EM = "11 de outubro de 2026";

export default function TermosPage() {
  return (
    <>
      <h1>Termos de Uso</h1>
      <p className="lead">
        A EcoHorta Inteligente mexe com água de verdade, numa escola de verdade. Estes termos existem para que isso
        aconteça com segurança.
      </p>
      <p className="meta">Atualizados em {ATUALIZADA_EM}</p>

      <h2>O que é a EcoHorta</h2>
      <p>
        Um projeto escolar da <strong>EE Prof.ª Clarinda Mendes de Aquino</strong>, inscrito no Samsung Solve for
        Tomorrow Brasil. Um tubo capta a água que pinga dos aparelhos de ar-condicionado, um sensor mede quanto há lá
        dentro, e o aplicativo transforma esse volume em missões de reúso: regar a horta, lavar uma área, cuidar de um
        canteiro.
      </p>
      <p>
        Não é um serviço comercial. É um projeto educacional, mantido por professores e estudantes, e pode ficar fora do
        ar sem aviso.
      </p>

      <h2>Quem pode usar</h2>
      <p>
        Estudantes, professores e funcionários das escolas participantes. O cadastro é livre: quem entra com uma conta
        Google informa apelido, sexo, data de nascimento e função na escola.
      </p>
      <p>
        Estudantes <strong>menores de idade</strong> precisam de autorização do responsável para participar. A escola
        registra essa autorização antes do uso, conforme a{" "}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>
      <p>
        Você passa a fazer parte de uma escola ao ler o QR Code de um captador dela. Para mudar de escola, basta
        alterar no seu perfil — e ler o QR dos captadores de lá.
      </p>

      <h2>Como uma missão funciona</h2>
      <ol>
        <li>O aplicativo mostra quanta água existe no captador, medida pelo sensor.</li>
        <li>Você escolhe uma missão e vai até o captador.</li>
        <li>Lê o QR Code colado no tubo — é isso que prova que você está lá.</li>
        <li>Posiciona o balde ou regador e confirma os itens de segurança.</li>
        <li>Mantém o botão pressionado para abrir a torneira.</li>
        <li>A missão só é concluída pelo volume que o sensor <strong>mediu</strong> sair.</li>
      </ol>
      <p>
        Esse encadeamento não é enfeite. Sem a leitura do QR, qualquer pessoa esvaziaria o tubo de casa, por brincadeira
        ou por engano, e alguém encontraria o pátio molhado.
      </p>

      <h2>Segurança física</h2>
      <ul>
        <li>Faça missões apenas durante o horário combinado com a escola e com a supervisão prevista por ela.</li>
        <li>Água no chão escorrega. Avise, sinalize e limpe.</li>
        <li>Não beba a água do captador: é condensado, serve para regar e limpar, não para consumo.</li>
        <li>Não abra a caixa eletrônica nem mexa na instalação. Problema no captador se avisa à equipe responsável.</li>
        <li>Se algo parecer errado — vazamento, cheiro, fiação à mostra — não execute a missão e avise um adulto.</li>
      </ul>

      <h2>Pontos, ranking e mural</h2>
      <ul>
        <li>
          <strong>A pontuação base vem da missão executada</strong>, pelo volume que o sensor mediu. Nada de pedir uma
          quantidade e pontuar por ela: pontua o que saiu de verdade.
        </li>
        <li>
          Registrar a evidência da missão com uma foto dá um <strong>bônus de pontos</strong>. É opcional: quem não
          publica recebe a pontuação base igual e continua no ranking.
        </li>
        <li>
          <strong>Curtida não vale ponto.</strong> Se valesse, dois estudantes curtindo um ao outro subiriam no ranking
          sem economizar uma gota — e o ranking deixaria de medir água.
        </li>
        <li>
          No mural, publique o que tem a ver com a missão. Conteúdo ofensivo, foto de outra pessoa sem a autorização
          dela ou qualquer coisa fora do contexto escolar pode ser removida, e a conta, suspensa.
        </li>
        <li>Qualquer pessoa pode denunciar uma publicação dentro do aplicativo.</li>
      </ul>

      <h2>Dados simulados</h2>
      <p>
        A plataforma tem um modo de simulação, para testes e demonstrações. Tudo que vem dele aparece marcado como{" "}
        <strong>SIMULAÇÃO</strong> e <strong>nunca</strong> entra em impacto, ranking ou missão concluída. Da mesma
        forma, quando um captador está sem conexão, o volume mostrado é uma <strong>ESTIMATIVA</strong> — e também não
        conta. Só o que o sensor mediu conta.
      </p>

      <h2>Uso indevido</h2>
      <p>
        Tentar burlar a leitura do QR, forjar missões, liberar água sem necessidade, usar a conta de outra pessoa ou
        atrapalhar o funcionamento dos captadores leva à suspensão da conta e à comunicação à direção da escola.
      </p>

      <h2>Saindo do projeto</h2>
      <p>
        Você pode pedir a exclusão da sua conta a qualquer momento, pela coordenação do projeto ou pelo e-mail{" "}
        <a href="mailto:professorvantini@gmail.com">professorvantini@gmail.com</a>. O que acontece com cada dado está na{" "}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2>Mudanças nestes termos</h2>
      <p>Se mudarem, a data no topo muda junto, e o aviso aparece dentro do aplicativo.</p>
    </>
  );
}
